/*
 * Offline Electron -> IPC -> gevent-WebSocket diagnostic.
 *
 * This never calls Deepgram/OpenAI. The gevent server sends one successful
 * analysis and one structured analysis_timeout response, allowing the hosted
 * client and Electron IPC correlation to be checked independently of provider
 * latency. Run explicitly with RUN_INTELLI_OFFLINE_E2E=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const appRoot = path.resolve(__dirname, '..');
const pythonBin = '/tmp/laserreach-visibility-py311/bin/python';
const runEnabled = process.env.RUN_INTELLI_OFFLINE_E2E === '1';

function findElectronBinary() {
  const packageRoot = path.dirname(require.resolve('electron'));
  const candidate = process.platform === 'darwin'
    ? path.join(packageRoot, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : process.platform === 'win32'
      ? path.join(packageRoot, 'dist', 'electron.exe')
      : path.join(packageRoot, 'dist', 'electron');
  return fs.existsSync(candidate) ? candidate : null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function waitForChildExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once('exit', done);
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      done();
    }, timeoutMs);
  });
}

async function waitForTcp(port, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        socket.once('connect', () => { socket.end(); resolve(); });
        socket.once('error', reject);
        socket.setTimeout(500, () => socket.destroy(new Error('timeout')));
      });
      return;
    } catch (_) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Timed out waiting for fake gevent server:${port}`);
}

async function waitForPageTarget(debugPort, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const body = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${debugPort}/json`, (res) => {
          let out = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { out += chunk; });
          res.on('end', () => resolve(out));
        }).once('error', reject);
      });
      const target = JSON.parse(body).find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
      if (target) return target;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for Electron renderer target');
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
    this.socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch (_) { return; }
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || 'CDP error'));
      else resolve(message.result || {});
    });
  }

  async command(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = false) {
    const result = await this.command('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'renderer evaluation failed');
    if (result.result?.subtype === 'error') throw new Error(result.result.description || 'renderer evaluation failed');
    return result.result?.value;
  }

  close() {
    try { this.socket.close(); } catch (_) {}
  }
}

async function waitUntil(read, predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function fakeGeventServerScript() {
  return String.raw`
import json
import sys
from gevent import pywsgi
from geventwebsocket.handler import WebSocketHandler

port = int(sys.argv[1])
received = []

def app(env, start_response):
    path = env.get("PATH_INFO", "")
    if path == "/api/abm/intelli/analyze/ws":
        ws = env.get("wsgi.websocket")
        if ws is None:
            start_response("426 Upgrade Required", [("Content-Type", "text/plain")])
            return [b"websocket required"]
        while True:
            raw = ws.receive()
            if raw is None:
                return []
            msg = json.loads(raw)
            received.append({"op": msg.get("op"), "request_id": msg.get("request_id"), "id": msg.get("id")})
            if msg.get("op") != "analyze":
                continue
            request_id = msg.get("request_id")
            print("FAKE_ANALYZE " + str(request_id), flush=True)
            ws.send(json.dumps({"op": "analysis_status", "request_id": request_id, "success": True, "status": "running", "message": "running"}))
            if msg.get("prompt") == "offline-timeout":
                ws.send(json.dumps({"op": "error", "request_id": request_id, "success": False, "error": "analysis_timeout", "code": "analysis_timeout"}))
            else:
                ws.send(json.dumps({"op": "analysis_status", "request_id": request_id, "success": True, "status": "done", "message": "done"}))
                ws.send(json.dumps({"op": "analysis_result", "request_id": request_id, "success": True, "analysis_type": "summary", "model": "offline-fake", "parsed": {"summary": "offline coaching result"}, "text": "offline coaching result", "usage": {"total_tokens": 3}, "context": {"pipeline_id": "offline-pipeline"}}))
        return []
    if path == "/me/orgs":
        body = b'[{"org_id":"offline-org","name":"Offline Intelli"}]'
    else:
        body = b'{"success":true}'
    start_response("200 OK", [("Content-Type", "application/json"), ("Content-Length", str(len(body)))])
    return [body]

pywsgi.WSGIServer(("127.0.0.1", port), app, handler_class=WebSocketHandler).serve_forever()
`;
}

test('real Electron IPC reaches fake gevent WS and correlates status/result/error', {
  skip: runEnabled ? false : 'set RUN_INTELLI_OFFLINE_E2E=1 to run the offline Electron diagnostic',
  timeout: 90000,
}, async () => {
  assert.ok(fs.existsSync(pythonBin), 'pinned Python runtime is installed');
  const binary = findElectronBinary();
  assert.ok(binary, 'Electron binary is installed');
  const serverPort = await freePort();
  const debugPort = await freePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laserreach-intelli-offline-'));
  const fakeServer = spawn(pythonBin, ['-c', fakeGeventServerScript(), String(serverPort)], {
    cwd: appRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let fakeOutput = '';
  fakeServer.stdout.on('data', (chunk) => { fakeOutput += chunk.toString(); });
  let electron;
  let renderer;
  try {
    await waitForTcp(serverPort);
    fs.writeFileSync(path.join(profileDir, 'settings.json'), JSON.stringify({ hosted: {
      backendUrl: `http://127.0.0.1:${serverPort}`,
      frontendUrl: `http://127.0.0.1:${serverPort}`,
      tenantId: 'offline-org',
      jwtToken: 'offline-token',
      analysisModel: 'gpt-5-mini',
      defaultPipelineId: 'offline-pipeline',
    } }, null, 2), { mode: 0o600 });
    electron = spawn(binary, [appRoot, '--headless', '--disable-gpu', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`], {
      cwd: appRoot,
      env: { ...process.env, INTELLI_CAPTURE_PROTECTION: 'off', INTELLI_STARTUP_SMOKE: '1' },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const target = await waitForPageTarget(debugPort);
    renderer = new CdpClient(target.webSocketDebuggerUrl);
    await renderer.evaluate(`(() => {
      window.__offlineE2E = { responses: [], statuses: [] };
      window.electronAPI.onAnalysisResponse((event) => window.__offlineE2E.responses.push(event.data || event));
      window.electronAPI.onStatus((msg) => window.__offlineE2E.statuses.push({ ...msg, observed_at: Date.now() }));
      return true;
    })()`);
    await renderer.evaluate(`window.electronAPI.sendAnalysisRequest(${JSON.stringify({
      id: 'offline-complete',
      transcript: 'offline transcript',
      prompt: 'offline-complete',
      analysisType: 'summary',
      pipelineId: 'offline-pipeline',
      model: 'gpt-5-mini',
    })})`);
    await renderer.evaluate(`window.electronAPI.sendAnalysisRequest(${JSON.stringify({
      id: 'offline-timeout',
      transcript: 'offline timeout transcript',
      prompt: 'offline-timeout',
      analysisType: 'summary',
      pipelineId: 'offline-pipeline',
      model: 'gpt-5-mini',
    })})`);
    const observed = await waitUntil(
      () => renderer.evaluate('window.__offlineE2E'),
      (value) => (value.responses || []).some((item) => item.id === 'offline-complete')
        && (value.responses || []).some((item) => item.id === 'offline-timeout'),
      15000,
      'offline Electron analysis responses',
    );
    const complete = observed.responses.find((item) => item.id === 'offline-complete');
    const timedOut = observed.responses.find((item) => item.id === 'offline-timeout');
    assert.equal(complete.error, undefined);
    assert.equal(complete.raw?.context?.pipeline_id, 'offline-pipeline');
    assert.equal(timedOut.error, 'analysis_timeout');
    assert.equal((fakeOutput.match(/FAKE_ANALYZE analysis_/g) || []).length, 2);
    assert.equal(observed.statuses.length, 3);
    assert.ok(observed.statuses.every((status) => /^analysis_/.test(String(status.requestId || ''))));
    assert.ok(observed.statuses.every((status) => status.requestId !== 'offline-complete' && status.requestId !== 'offline-timeout'));
    process.stdout.write(`[offline-intelli-e2e] responses=${observed.responses.length} statuses=${observed.statuses.length} generated_request_ids=true provider_calls=0 asr_calls=0\n`);
  } finally {
    if (renderer) renderer.close();
    if (electron && electron.exitCode === null && !electron.signalCode) electron.kill('SIGTERM');
    if (electron) await waitForChildExit(electron);
    if (fakeServer && fakeServer.exitCode === null && !fakeServer.signalCode) fakeServer.kill('SIGTERM');
    if (fakeServer) await waitForChildExit(fakeServer);
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});
