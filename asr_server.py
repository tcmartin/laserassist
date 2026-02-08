#!/usr/bin/env python3
"""
NeMo ASR streaming server.

Provides a streaming transcription service over WebSocket (binary PCM frames)
and an optional stdio JSON mode for MAS-friendly embedding without requiring
network.server entitlements. Loads the NeMo model once and performs rolling-
window transcription with partial updates.

Protocol (WebSocket):
  - Client connects to ws://HOST:PORT/ (default :8765)
  - First JSON message is optional config:
      {"op":"start", "sample_rate":16000, "format":"s16le", "window":5, "update_ms":1000}
    Defaults: 16 kHz, s16le mono, 5 s window, 1000 ms updates
  - Send binary messages containing raw PCM (s16le, mono) audio frames
  - Server sends JSON messages:
      {"op":"partial","text":"...","ts":<unix_ms>}
      {"op":"final","text":"...","ts":<unix_ms>}
      {"op":"error","message":"..."}
  - Send {"op":"stop"} to end the session and receive a final message.

Protocol (stdio JSONL):
  - One JSON object per line, UTF-8. Commands:
      {"op":"start", "sample_rate":16000, "format":"s16le", "window":5, "update_ms":1000}
      {"op":"audio","base64":"..."}  # s16le mono 16 kHz PCM
      {"op":"stop"}
    Responses mirrored as JSONL with same shape as WebSocket messages.

Notes for MAS:
  - Prefer stdio mode to avoid com.apple.security.network.server entitlement.
  - Model/transformer cache is redirected under user data dir by default.
"""

import argparse
import asyncio
import base64
import dataclasses
import json
import os
import sys
import tempfile
import time
import wave
from collections import deque
from typing import Deque, Optional
from concurrent.futures import ThreadPoolExecutor

import numpy as np

try:
    import websockets  # type: ignore
except Exception:
    websockets = None  # Optional; required only for websocket mode

try:
    import nemo.collections.asr as nemo_asr  # type: ignore
except Exception as e:
    nemo_asr = None
    _asr_import_err = e

# Fallback transcription using transformers if NeMo is not available
try:
    from transformers import pipeline
    _transformers_available = True
except Exception:
    _transformers_available = False

try:
    import pyaudio as pa  # type: ignore
except Exception:
    pa = None


import logging

# Keep third-party logs off stdout to not break JSONL protocol
logging.basicConfig(level=logging.ERROR, stream=sys.stderr)
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("TORCH_CPP_LOG_LEVEL", "ERROR")

DEFAULT_MODEL = "nvidia/parakeet-tdt-0.6b-v3"
DEFAULT_SAMPLE_RATE = 16000


def _default_cache_dir() -> str:
    app_name = os.environ.get("ASR_APP_NAME", "Cluely")
    # macOS app support path inside sandbox/user
    if sys.platform == "darwin":
        base = os.path.expanduser(f"~/Library/Application Support/{app_name}/ASR")
    else:
        base = os.path.expanduser(f"~/.cache/{app_name.lower()}/asr")
    os.makedirs(base, exist_ok=True)
    return base


def _configure_hf_cache(cache_dir: str) -> None:
    # Redirect common caches into our app support dir to play nice with sandboxing
    os.environ.setdefault("HF_HOME", os.path.join(cache_dir, "hf"))
    os.environ.setdefault("TRANSFORMERS_CACHE", os.path.join(cache_dir, "hf", "transformers"))
    os.environ.setdefault("TORCH_HOME", os.path.join(cache_dir, "torch"))
    os.environ.setdefault("NEMO_HOME", os.path.join(cache_dir, "nemo"))
    # Ensure directories exist
    for key in ("HF_HOME", "TRANSFORMERS_CACHE", "TORCH_HOME", "NEMO_HOME"):
        os.makedirs(os.environ[key], exist_ok=True)


@dataclasses.dataclass
class SessionConfig:
    sample_rate: int = DEFAULT_SAMPLE_RATE
    fmt: str = "s16le"  # only s16le supported
    window_seconds: int = 5
    update_ms: int = 5000


class ASRSession:
    def __init__(self, asr_model, cfg: SessionConfig):
        self.asr_model = asr_model
        self.cfg = cfg
        # 16-bit PCM => 2 bytes/sample, mono
        self.buf: Deque[int] = deque(maxlen=self.cfg.sample_rate * self.cfg.window_seconds * 2)
        self._last_text = ""
        self._lock = asyncio.Lock()
        self._task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()
        self._mic_stream = None
        self._mic_p = None
        # Thread pool for non-blocking transcription
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ASR-Transcribe")

    def push_bytes(self, b: bytes) -> None:
        self.buf.extend(b)

    async def start(self, send_cb):
        self._stop.clear()
        self._task = asyncio.create_task(self._run_infer_loop(send_cb))

    async def stop(self):
        self._stop.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=2)
            except asyncio.TimeoutError:
                try:
                    self._task.cancel()
                except Exception:
                    pass
            except asyncio.CancelledError:
                # Treat cancellation as a clean stop
                pass
        # Stop mic if running
        try:
            if self._mic_stream is not None:
                self._mic_stream.stop_stream()
                self._mic_stream.close()
                self._mic_stream = None
        except Exception:
            pass
        try:
            if self._mic_p is not None:
                self._mic_p.terminate()
                self._mic_p = None
        except Exception:
            pass
        # Shutdown thread pool
        try:
            if hasattr(self, '_executor'):
                self._executor.shutdown(wait=False)
        except Exception:
            pass

    async def _run_infer_loop(self, send_cb):
        last_infer_time = 0
        interval_ms = max(100, int(self.cfg.update_ms))
        while not self._stop.is_set():
            now = time.time()
            if (now - last_infer_time) * 1000 >= interval_ms:
                try:
                    audio_bytes = self._snapshot_window_bytes()
                    if audio_bytes is None:
                        await asyncio.sleep(0.05)
                        continue
                    
                    logging.info(f"Starting transcription. Buffer size: {len(self.buf)}")
                    last_infer_time = now
                    transcribe_start_time = time.time()
                    
                    # Run transcription in dedicated thread pool to avoid blocking the event loop
                    loop = asyncio.get_event_loop()
                    text = await loop.run_in_executor(self._executor, self._transcribe_bytes, audio_bytes)
                    
                    transcribe_end_time = time.time()
                    logging.info(f"Transcription finished in {transcribe_end_time - transcribe_start_time:.2f}s. Result: '{text}'")
                    
                    if text:
                        self._last_text = text
                        await send_cb({"op": "partial", "text": text, "ts": int(time.time() * 1000)})
                except Exception as e:
                    logging.error(f"Exception in infer loop: {e}")
                    await send_cb({"op": "error", "message": f"{type(e).__name__}: {e}"})
            await asyncio.sleep(0.05)

    def _snapshot_window_bytes(self) -> Optional[bytes]:
        required = self.cfg.sample_rate * self.cfg.window_seconds * 2
        current_size = len(self.buf)
        if current_size == 0:
            return None
        
        if current_size < required:
            # Pad with silence (zeros)
            padding = bytes(required - current_size)
            return bytes(self.buf) + padding
        
        return bytes(self.buf)

    def _transcribe_bytes(self, pcm_bytes: bytes) -> str:
        # Write a temporary wav file for transcription
        tmp_path = None
        try:
            # Decode incoming PCM (s16le at cfg.sample_rate)
            x = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
            sr = int(self.cfg.sample_rate)
            target_sr = DEFAULT_SAMPLE_RATE
            if sr != target_sr and x.size > 1:
                # Resample to 16k using linear interpolation
                src_idx = np.linspace(0, x.size - 1, num=int(x.size * target_sr / sr), endpoint=True, dtype=np.float32)
                base = np.floor(src_idx).astype(np.int32)
                frac = src_idx - base
                base2 = np.minimum(base + 1, x.size - 1)
                x = (1.0 - frac) * x[base] + frac * x[base2]
                sr = target_sr
            # Convert back to int16 for WAV
            y = np.clip(x * 32767.0, -32768, 32767).astype(np.int16)
            fd, tmp_path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)
            with wave.open(tmp_path, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(sr)
                wf.writeframes(y.tobytes())
            
            # Run transcription based on available backend
            import contextlib
            with contextlib.redirect_stdout(sys.stderr):
                if hasattr(self.asr_model, 'transcribe'):
                    # NeMo model
                    out = self.asr_model.transcribe([tmp_path])
                    first = out[0] if out else ""
                    if isinstance(first, str):
                        return first
                    return getattr(first, "text", "") or ""
                else:
                    # Transformers pipeline
                    result = self.asr_model(tmp_path)
                    if isinstance(result, dict) and 'text' in result:
                        return result['text']
                    elif isinstance(result, str):
                        return result
                    return ""
        except Exception as e:
            logging.error(f"Transcription error: {e}")
            return ""
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass


def load_model(model_name: str, cache_dir: str):
    _configure_hf_cache(cache_dir)
    
    # Try NeMo first
    if nemo_asr is not None:
        try:
            asr_model = nemo_asr.models.ASRModel.from_pretrained(model_name=model_name)
            asr_model.eval()
            return asr_model
        except Exception as e:
            print(f"Warning: NeMo model loading failed: {e}", file=sys.stderr)
    
    # Fallback to transformers-based ASR
    if _transformers_available:
        try:
            print("Using transformers fallback for ASR", file=sys.stderr)
            # Rely on TRANSFORMERS_CACHE/HF_HOME env from _configure_hf_cache
            asr_model = pipeline(
                "automatic-speech-recognition",
                model="openai/whisper-base",
                device=-1  # CPU
            )
            return asr_model
        except Exception as e:
            print(f"Warning: Transformers model loading failed: {e}", file=sys.stderr)
    
    # If both fail, raise error
    raise RuntimeError(f"No ASR backend available. NeMo error: {_asr_import_err}")


async def ws_handler(websocket):
    # Per-connection session
    cfg = SessionConfig()
    session = ASRSession(ws_handler.asr_model, cfg)

    async def send_cb(msg):
        await websocket.send(json.dumps(msg))

    await session.start(send_cb)

    try:
        async for message in websocket:
            if isinstance(message, bytes):
                session.push_bytes(message)
            else:
                try:
                    data = json.loads(message)
                except Exception:
                    continue
                op = data.get("op")
                if op == "start":
                    cfg.sample_rate = int(data.get("sample_rate", cfg.sample_rate))
                    cfg.window_seconds = int(data.get("window", cfg.window_seconds))
                    cfg.update_ms = int(data.get("update_ms", cfg.update_ms))
                elif op == "stop":
                    await session.stop()
                    await send_cb({"op": "final", "text": session._last_text, "ts": int(time.time() * 1000)})
                    break
    finally:
        try:
            await session.stop()
        except Exception:
            pass


async def run_websocket(host: str, port: int):
    if websockets is None:
        raise RuntimeError("websockets package not installed; install with `pip install websockets`. ")
    async with websockets.serve(ws_handler, host, port, max_size=None, ping_interval=None):
        print(f"ASR WebSocket listening on ws://{host}:{port}")
        await asyncio.Future()  # run forever


async def run_stdio():
    cfg = SessionConfig()
    session = ASRSession(run_stdio.asr_model, cfg)

    async def send_cb(msg):
        sys.stdout.write(json.dumps(msg) + "\n")
        sys.stdout.flush()

    await session.start(send_cb)

    loop = asyncio.get_running_loop()

    async def read_stdin_line():
        return await loop.run_in_executor(None, sys.stdin.readline)

    try:
        while True:
            line = await read_stdin_line()
            if not line:
                break
            try:
                data = json.loads(line)
            except Exception:
                continue
            op = data.get("op")
            if op == "start":
                cfg.sample_rate = int(data.get("sample_rate", cfg.sample_rate))
                cfg.window_seconds = int(data.get("window", cfg.window_seconds))
                cfg.update_ms = int(data.get("update_ms", cfg.update_ms))
                # Optional mic-source mode (test.py style)
                source = data.get("source")
                if source == "mic":
                    if pa is None:
                        await send_cb({"op": "error", "message": "PyAudio not available"})
                    else:
                        try:
                            if session._mic_p is None:
                                session._mic_p = pa.PyAudio()
                            dev_index = data.get("device_index")
                            frames_per_buffer = max(256, int(cfg.sample_rate * 0.02))  # ~20ms
                            def _callback(in_data, frame_count, time_info, status_flags):
                                try:
                                    session.push_bytes(in_data)
                                except Exception:
                                    pass
                                return (None, pa.paContinue)
                            session._mic_stream = session._mic_p.open(
                                format=pa.paInt16,
                                channels=1,
                                rate=cfg.sample_rate,
                                input=True,
                                input_device_index=dev_index if isinstance(dev_index, int) else None,
                                frames_per_buffer=frames_per_buffer,
                                stream_callback=_callback,
                            )
                            session._mic_stream.start_stream()
                            await send_cb({"op": "status", "message": f"Mic capture started @ {cfg.sample_rate} Hz\n"})
                        except Exception as e:
                            await send_cb({"op": "error", "message": f"Mic start failed: {e}"})
            elif op == "audio":
                b64 = data.get("base64")
                if b64:
                    session.push_bytes(base64.b64decode(b64))
            elif op == "stop":
                await session.stop()
                await send_cb({"op": "final", "text": session._last_text, "ts": int(time.time() * 1000)})
                break
    finally:
        try:
            await session.stop()
        except asyncio.CancelledError:
            pass
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser(description="NeMo ASR streaming server")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Model name for NeMo from_pretrained")
    parser.add_argument("--cache-dir", default=_default_cache_dir(), help="Cache dir for model/data")
    parser.add_argument("--mode", choices=["websocket", "stdio"], default="stdio", help="Server mode")
    parser.add_argument("--host", default="127.0.0.1", help="WebSocket host")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket port")
    parser.add_argument("--prefetch", action="store_true", help="Download model then exit")
    args = parser.parse_args()

    # Load model first; trigger download if necessary into cache_dir
    asr_model = load_model(args.model, args.cache_dir)

    if args.prefetch:
        print("Model cached; exiting (--prefetch)")
        return

    # Bind model to handlers
    ws_handler.asr_model = asr_model  # type: ignore
    run_stdio.asr_model = asr_model  # type: ignore

    if args.mode == "websocket":
        asyncio.run(run_websocket(args.host, args.port))
    else:
        asyncio.run(run_stdio())


if __name__ == "__main__":
    main()
