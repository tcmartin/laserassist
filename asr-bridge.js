const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const EventEmitter = require('events');

class ASRBridge extends EventEmitter {
  constructor(app, log = console) {
    super();
    this.app = app;
    this.log = log;
    this.child = null;
    this._buf = '';
    this._started = false;
  }

  _resolveHelper() {
    // Allow explicit override
    const override = process.env.ASR_HELPER_PATH;
    if (override && fs.existsSync(override)) return { cmd: override, args: ['--mode', 'stdio'] };

    // For packaged apps, look for unpacked Python script
    if (this.app && this.app.isPackaged) {
      try {
        const resources = process.resourcesPath;
        if (resources) {
          // Check for unpacked script (electron-builder asarUnpack)
          const unpackedScript = path.join(resources, 'app.asar.unpacked', 'asr_server.py');
          if (fs.existsSync(unpackedScript)) {
            return { cmd: process.env.PYTHON || 'python3', args: [unpackedScript, '--mode', 'stdio'] };
          }
          
          // Fallback: extract to userData if unpacked version not found
          const userDataDir = this.app.getPath('userData');
          const extractedScript = path.join(userDataDir, 'asr_server.py');
          
          if (!fs.existsSync(extractedScript)) {
            const asarScript = path.join(__dirname, 'asr_server.py');
            const scriptContent = fs.readFileSync(asarScript, 'utf8');
            fs.writeFileSync(extractedScript, scriptContent);
            this.log.log('[ASR] Extracted Python script to userData');
          }
          
          if (fs.existsSync(extractedScript)) {
            return { cmd: process.env.PYTHON || 'python3', args: [extractedScript, '--mode', 'stdio'] };
          }
        }
      } catch (e) {
        this.log.error('[ASR] Failed to resolve packaged script:', e.message);
      }
    }

    // Dev fallback: prefer local virtualenv if present, else system python
    const script = path.join(__dirname, 'asr_server.py');
    const isWin = process.platform === 'win32';
    const venvDir = path.join(__dirname, 'asr-dev-env');
    const venvPython = isWin
      ? path.join(venvDir, 'Scripts', 'python.exe')
      : path.join(venvDir, 'bin', 'python');

    if (fs.existsSync(venvPython)) {
      return { cmd: venvPython, args: [script, '--mode', 'stdio'] };
    }
    return { cmd: process.env.PYTHON || 'python3', args: [script, '--mode', 'stdio'] };
  }

  start(options = {}) {
    if (this.child) {
      this.setConfig(options);
      return; // already started
    }
    const { cmd, args } = this._resolveHelper();
    // Python is the only supported helper
    const isPython = cmd.includes('python');
    this.log.log('[ASR] Spawning helper:', cmd, args.join(' '));
    if (isPython) {
      try { this.emit('status', { message: 'ASR helper binary not found; using Python script (dev)\n' }); } catch {}
    }
    const env = {
      ...process.env,
      ASR_APP_NAME: this.app?.getName?.() || 'Insighto'
    };

    this.child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env });

    this.child.on('error', (err) => {
      this.emit('error', { message: `spawn error: ${err.message}` });
    });
    this.child.on('close', (code, signal) => {
      if (code !== 0 && code !== null) {
        this.emit('error', { message: `ASR helper exited: code ${code} signal ${signal || ''}` });
        // No restart path to non-Python helper; allow restart via next start()
      }
      // Allow restart on next start() call
      this.child = null;
      this._started = false;
    });
    this.child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      // Route as debug logs to avoid flooding UI
      this.log.debug ? this.log.debug('[ASR stderr]', s) : this.log.log('[ASR stderr]', s);
      // Emit as status so renderer can show it
      try { this.emit('status', { message: s }); } catch {}
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      this._buf += chunk;
      let idx;
      while ((idx = this._buf.indexOf('\n')) >= 0) {
        const line = this._buf.slice(0, idx);
        this._buf = this._buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.op === 'partial') this.emit('partial', msg);
          else if (msg.op === 'final') this.emit('final', msg);
          else if (msg.op === 'error') this.emit('error', msg);
          else this.emit('status', { message: line + '\n' });
        } catch (e) {
          // Non-JSON line (e.g., progress bars); treat as status, not an error
          this.emit('status', { message: line + '\n' });
        }
      }
    });

    // send start config
    const startMsg = {
      op: 'start',
      sample_rate: options.sampleRate || 16000,
      window: options.window || 5,
      update_ms: options.updateMs || 1000,
    };
    if (options.source) startMsg.source = options.source;
    if (typeof options.device_index !== 'undefined') startMsg.device_index = options.device_index;
    this._writeJSON(startMsg);
    // Notify renderer we spawned
    try { this.emit('status', { message: 'ASR helper spawned (stdio mode)\n' }); } catch {}
    this._started = true;
  }

  isRunning() { return !!this.child; }

  setConfig(options = {}) {
    const msg = {
      op: 'start',
      sample_rate: options.sampleRate || 16000,
      window: options.window || 5,
      update_ms: options.updateMs || 1000,
    };
    this._writeJSON(msg);
  }

  _writeJSON(obj) {
    if (!this.child || !this.child.stdin.writable) return;
    try {
      this.child.stdin.write(JSON.stringify(obj) + '\n');
    } catch (e) {
      this.emit('error', { message: 'stdin write error: ' + e.message });
    }
  }

  sendBase64(base64) {
    // Use setImmediate to avoid blocking the main thread when sending large audio chunks
    setImmediate(() => {
      this._writeJSON({ op: 'audio', base64 });
    });
  }

  stop() {
    if (this.child) {
      this._writeJSON({ op: 'stop' });
    }
  }

  dispose() {
    try { this.stop(); } catch {}
    if (this.child) {
      try { this.child.kill(); } catch {}
      this.child = null;
    }
  }
}

module.exports = ASRBridge;
