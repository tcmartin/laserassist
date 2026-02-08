ASR Streaming Server (NeMo)

Overview
- File: `asr_server.py` provides a streaming ASR service around NeMo (`nvidia/parakeet-tdt-0.6b-v3`).
- Modes:
  - `stdio` (default): JSONL over stdin/stdout. MAS‑friendly; no network.server entitlement.
  - `websocket`: Binary PCM over WebSocket. Use outside MAS or if you have the entitlement.

Run Locally
- Install deps: `pip install -r requirements-asr.txt`
- Start stdio mode: `python3 asr_server.py --mode stdio`
- Start WebSocket: `python3 asr_server.py --mode websocket --host 127.0.0.1 --port 8765`

Model Download/Cache
- The server sets `HF_HOME`, `TRANSFORMERS_CACHE`, `TORCH_HOME`, and `NEMO_HOME` under:
  - macOS: `~/Library/Application Support/Cluely/ASR` (or override with `ASR_APP_NAME` or `--cache-dir`).
  - Linux: `~/.cache/cluely/asr`.
- On first run, NeMo downloads model assets into this cache.

Electron Integration (stdio; recommended for MAS)
```js
// main.js (Electron main process)
const { spawn } = require('child_process');

function startASR(binaryPath) {
  const child = spawn(binaryPath, ['--mode', 'stdio'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, ASR_APP_NAME: 'Cluely' },
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    chunk.trim().split(/\n+/).forEach((line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.op === 'partial' || msg.op === 'final') {
          // forward to renderer or handle transcript updates
        }
      } catch (_) {}
    });
  });

  // Initialize session
  child.stdin.write(JSON.stringify({ op: 'start', sample_rate: 16000, window: 5, update_ms: 1000 }) + '\n');

  return {
    pushPcm: (buf /* Buffer of s16le mono 16kHz */) => {
      const b64 = buf.toString('base64');
      child.stdin.write(JSON.stringify({ op: 'audio', base64: b64 }) + '\n');
    },
    stop: () => {
      child.stdin.write(JSON.stringify({ op: 'stop' }) + '\n');
    },
    kill: () => child.kill(),
  };
}
```

Production helper resolution
- The app looks for the helper in this order:
  - `ASR_HELPER_PATH` env var (absolute path to binary)
  - Packaged app default: `Contents/MacOS/cluely-asr` (macOS) or next to the main executable (Linux/Windows)
  - Dev fallback: `python3 asr_server.py --mode stdio`

Electron Integration (WebSocket; outside MAS)
```js
// Use a ws client to send binary s16le mono 16kHz frames
// First send: {op:'start', sample_rate:16000, window:5, update_ms:1000}
```

Building a Single Binary (for bundling inside .app)
- PyInstaller is the simplest path:
  - `pip install pyinstaller`
  - `pyinstaller --onefile --name cluely-asr asr_server.py`
  - Sign the resulting binary and bundle it under `YourApp.app/Contents/MacOS/`.
- Notes:
  - NeMo/Torch produce large binaries. Test on clean machines.
  - Sign nested executables in your app bundle before signing the .app.
  - MAS: Avoid `--hidden-import` hacks that disable library validation.

MAS Considerations
- Prefer stdio mode; otherwise you likely need `com.apple.security.network.server` entitlement for WebSocket.
- Downloaded model weights are treated as data (not executable). Store them under the app’s container (default paths above).
- Ensure the spawned helper inherits App Sandbox and runs with no additional permissions than your app.

API Stability & Tuning
- Update cadence: tweak `window` and `update_ms` for latency vs. stability.
- Audio format: only s16le mono 16kHz is accepted; resample before sending if needed.
