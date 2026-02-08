import time
import os
import wave
import tempfile
import threading
import queue
from collections import deque

import numpy as np

try:
    import pyaudio as pa
except Exception:
    pa = None

import nemo.collections.asr as nemo_asr


MODEL_NAME = "nvidia/parakeet-tdt-0.6b-v3"
SAMPLE_RATE = 16000  # Hz


def main():
    if pa is None:
        print("PyAudio not found. Install with `pip install pyaudio`.")
        return

    # Load your original model
    asr_model = nemo_asr.models.ASRModel.from_pretrained(model_name=MODEL_NAME)
    asr_model.eval()

    # Simple, robust rolling-window streaming using transcribe()
    run_simple_streaming(asr_model)


def run_simple_streaming(asr_model):
    # Config
    chunk_ms = 320             # Mic read size
    update_interval_ms = 5000  # Transcribe every 5 seconds
    window_seconds = 5         # Transcribe last 5 seconds only

    frames_per_buffer = int(SAMPLE_RATE * chunk_ms / 1000)
    buffer_capacity = SAMPLE_RATE * window_seconds * 2  # 16-bit PCM -> 2 bytes/sample
    buf = deque(maxlen=buffer_capacity)  # stores raw PCM bytes
    buf_lock = threading.Lock()

    infer_q: "queue.Queue[bytes]" = queue.Queue(maxsize=1)
    stop_event = threading.Event()

    p = pa.PyAudio()

    # List input devices
    print("Available audio input devices:")
    input_devices = []
    for i in range(p.get_device_count()):
        dev = p.get_device_info_by_index(i)
        if dev.get("maxInputChannels"):
            input_devices.append(i)
            print(i, dev.get("name"))

    if not input_devices:
        print("ERROR: No audio input device found.")
        p.terminate()
        return

    # Ask user to select device
    dev_idx = -2
    while dev_idx not in input_devices:
        try:
            dev_idx = int(input("Please type input device ID: "))
        except Exception:
            continue

    last_infer_time = 0.0

    def extract_text(out):
        if not out:
            return ""
        first = out[0]
        # NeMo can return List[str] or List[objects with .text]
        if isinstance(first, str):
            return first
        return getattr(first, "text", "")

    # Background worker thread: does blocking transcribe so capture never stops
    def worker():
        last_text = ""
        while not stop_event.is_set():
            try:
                audio_bytes = infer_q.get(timeout=0.1)
            except queue.Empty:
                continue

            tmp_path = None
            try:
                fd, tmp_path = tempfile.mkstemp(suffix=".wav")
                os.close(fd)
                with wave.open(tmp_path, "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)  # 16-bit PCM
                    wf.setframerate(SAMPLE_RATE)
                    wf.writeframes(audio_bytes)

                out = asr_model.transcribe([tmp_path])
                text = extract_text(out)

                delta = text[len(last_text):] if text.startswith(last_text) else text
                if delta:
                    print(delta, end="", flush=True)
                last_text = text
            except Exception:
                pass
            finally:
                if tmp_path and os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except Exception:
                        pass
                infer_q.task_done()

    t = threading.Thread(target=worker, daemon=True)
    t.start()

    def callback(in_data, frame_count, time_info, status_flags):
        with buf_lock:
            buf.extend(in_data)
        return (in_data, pa.paContinue)

    stream = p.open(
        format=pa.paInt16,
        channels=1,
        rate=SAMPLE_RATE,
        input=True,
        input_device_index=dev_idx,
        frames_per_buffer=max(1, frames_per_buffer),
        stream_callback=callback,
    )

    print("Listening (5s rolling-window)… Press Ctrl+C to stop.")
    stream.start_stream()
    try:
        while stream.is_active():
            time.sleep(0.05)
            now = time.time()
            if (now - last_infer_time) * 1000.0 >= update_interval_ms and not infer_q.full():
                required_bytes = SAMPLE_RATE * 2 * window_seconds
                with buf_lock:
                    if len(buf) >= required_bytes:
                        audio_bytes = bytes(buf)
                    else:
                        audio_bytes = None
                if audio_bytes is not None:
                    infer_q.put(audio_bytes)
                    last_infer_time = now
    except KeyboardInterrupt:
        pass
    finally:
        stop_event.set()
        try:
            infer_q.join()
        except Exception:
            pass
        try:
            t.join(timeout=0.5)
        except Exception:
            pass
        stream.stop_stream()
        stream.close()
        p.terminate()
        print("\nPyAudio stopped")


if __name__ == "__main__":
    main()
