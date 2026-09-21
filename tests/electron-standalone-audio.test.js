/*
 * Opt-in Electron boundary test for the standalone microphone + display-audio
 * capture path. The two sources are generated inside the renderer from the
 * cached buyer WAV files and are supplied through the browser capture APIs.
 * This proves the app's Start/Stop, PCM, ASR, analysis, and overlay path without
 * claiming that macOS provides real system-audio capture in this test.
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
const corpusRoot = path.join(__dirname, 'fixtures');
const buyerAudioPath = path.join(corpusRoot, 'standalone-buyer.wav');
const followupAudioPath = path.join(corpusRoot, 'standalone-buyer-followup.wav');
const runEnabled = process.env.RUN_INTELLI_STANDALONE_AUDIO_E2E === '1';
const packagedBinary = process.env.INTELLI_PACKAGED_BIN;

function findElectronBinary() {
  if (process.env.INTELLI_ELECTRON_BIN && fs.existsSync(process.env.INTELLI_ELECTRON_BIN)) {
    return process.env.INTELLI_ELECTRON_BIN;
  }
  // Execute the package entrypoint once in opt-in runs; Electron's installer
  // may materialize the platform binary lazily after npm install.
  try { require('electron'); } catch (_) {}
  const packageRoot = path.dirname(require.resolve('electron'));
  const candidates = process.platform === 'darwin'
    ? [path.join(packageRoot, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')]
    : process.platform === 'win32'
      ? [path.join(packageRoot, 'dist', 'electron.exe')]
      : [path.join(packageRoot, 'dist', 'electron')];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
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

function waitForChildExit(child, timeoutMs = 10000) {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    const done = () => { clearTimeout(timer); resolve(); };
    child.once('exit', done);
    timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, timeoutMs);
  });
}

async function waitForPageTarget(debugPort, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const body = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${debugPort}/json`, (res) => {
          let output = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { output += chunk; });
          res.on('end', () => resolve(output));
        }).once('error', reject);
      });
      const target = JSON.parse(body).find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
      if (target) return target;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for Electron renderer target');
}

async function pageTargets(debugPort) {
  const body = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${debugPort}/json`, (res) => {
      let output = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { output += chunk; });
      res.on('end', () => resolve(output));
    }).once('error', reject);
  });
  return JSON.parse(body).filter((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
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
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'CDP error'));
      else pending.resolve(message.result || {});
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
    const result = await this.command('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'renderer evaluation failed');
    if (result.result?.subtype === 'error') throw new Error(result.result.description || 'renderer evaluation failed');
    return result.result?.value;
  }

  close() { try { this.socket.close(); } catch (_) {} }
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

function pcmRms(audioB64) {
  const bytes = Buffer.from(String(audioB64 || ''), 'base64');
  if (bytes.length < 2) return 0;
  let sum = 0;
  for (let offset = 0; offset + 1 < bytes.length; offset += 2) {
    const sample = bytes.readInt16LE(offset) / 32768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / Math.floor(bytes.length / 2));
}

function pcmToneMagnitude(audioB64, frequency, sampleRate = 16000) {
  const bytes = Buffer.from(String(audioB64 || ''), 'base64');
  const count = Math.floor(bytes.length / 2);
  if (count < 32) return 0;
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < count; index += 1) {
    const sample = bytes.readInt16LE(index * 2) / 32768;
    const angle = (2 * Math.PI * frequency * index) / sampleRate;
    real += sample * Math.cos(angle);
    imaginary -= sample * Math.sin(angle);
  }
  return Math.sqrt(real * real + imaginary * imaginary) / count;
}

function createFixture() {
  const metrics = {
    asrStarts: 0,
    asrEnds: 0,
    asrChunks: [],
    analyses: 0,
    sessions: { starts: 0, ends: 0 },
  };
  const server = http.createServer((req, res) => {
    const body = req.url?.startsWith('/api/abm/intelli/reminders')
      ? { success: true, reminders: [], count: 0 }
      : req.url === '/me/orgs'
        ? [{ org_id: 'standalone-audio-org', name: 'Standalone Audio' }]
        : { success: true };
    const encoded = Buffer.from(JSON.stringify(body));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': encoded.length });
    res.end(encoded);
  });
  const wss = new WebSocket.Server({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (!['/api/abm/intelli/transcribe/ws', '/api/abm/intelli/analyze/ws'].includes(pathname)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, pathname));
  });
  wss.on('connection', (ws, pathname) => {
    const kind = pathname.endsWith('/transcribe/ws') ? 'asr' : 'analysis';
    let transcriptSent = false;
    ws.on('message', (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch (_) { return; }
      const op = String(message.op || '');
      const requestId = String(message.request_id || '');
      if (kind === 'asr' && op === 'stream_start') {
        metrics.asrStarts += 1;
        ws.send(JSON.stringify({ success: true, request_id: requestId, stream_id: `stream_${metrics.asrStarts}` }));
        return;
      }
      if (kind === 'asr' && op === 'audio_chunk') {
        const rms = pcmRms(message.audio_b64);
        metrics.asrChunks.push({
          rms,
          tone220: pcmToneMagnitude(message.audio_b64, 220),
          tone880: pcmToneMagnitude(message.audio_b64, 880),
          bytes: Buffer.from(String(message.audio_b64 || ''), 'base64').length,
        });
        if (!transcriptSent && metrics.asrChunks.length >= 2) {
          transcriptSent = true;
          ws.send(JSON.stringify({
            op: 'transcript_event',
            text: 'The buyer asked about implementation timing and wants a clear follow-up plan before the next review.',
            is_final: true,
            speech_final: true,
            provider: 'offline-audio-fixture',
          }));
        }
        return;
      }
      if (kind === 'asr' && op === 'stream_end') {
        metrics.asrEnds += 1;
        ws.send(JSON.stringify({ success: true, request_id: requestId }));
        return;
      }
      if (kind !== 'analysis') return;
      if (op === 'session_start') metrics.sessions.starts += 1;
      if (op === 'session_end') metrics.sessions.ends += 1;
      if (op === 'analyze') {
        metrics.analyses += 1;
        ws.send(JSON.stringify({ op: 'analysis_status', request_id: requestId, success: true, status: 'running', message: 'running' }));
        ws.send(JSON.stringify({ op: 'analysis_status', request_id: requestId, success: true, status: 'done', message: 'done' }));
        ws.send(JSON.stringify({
          op: 'analysis_result',
          request_id: requestId,
          success: true,
          analysis_type: 'full',
          model: 'offline-audio-fixture',
          parsed: { summary: 'Injected mic and display audio reached standalone coaching.' },
          text: 'Injected mic and display audio reached standalone coaching.',
          usage: { total_tokens: 3 },
        }));
        return;
      }
      if (requestId) ws.send(JSON.stringify({ success: true, request_id: requestId, event_count: 1, session: { id: message.session_id } }));
    });
  });
  return {
    metrics,
    server,
    async listen() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      return server.address().port;
    },
    async close() {
      await new Promise((resolve) => wss.close(() => server.close(resolve)));
    },
  };
}

function signJwt(secret, subject) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { sub: subject, type: 'access', fresh: false, iat: now, nbf: now, jti: crypto.randomUUID(), exp: now + 3600, csrf: crypto.randomBytes(16).toString('hex'), '2fa_passed': true };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode(header)}.${encode(payload)}`;
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}

test('standalone Start/Stop mixes injected microphone and display audio into ASR and coaching', {
  skip: runEnabled ? false : 'set RUN_INTELLI_STANDALONE_AUDIO_E2E=1 for the injected standalone audio E2E',
  timeout: 120000,
}, async () => {
  assert.ok(fs.existsSync(buyerAudioPath), 'buyer.wav exists');
  assert.ok(fs.existsSync(followupAudioPath), 'buyer-followup.wav exists');
  const binary = findElectronBinary();
  assert.ok(binary, 'Electron binary is installed');

  const fixture = createFixture();
  const port = await fixture.listen();
  const debugPort = await freePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laserreach-standalone-audio-'));
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(profileDir, 'settings.json'), JSON.stringify({ hosted: {
    backendUrl: `http://127.0.0.1:${port}`,
    frontendUrl: `http://127.0.0.1:${port}`,
    tenantId: 'standalone-audio-org',
    jwtToken: signJwt(jwtSecret, 'standalone-audio-user'),
    analysisModel: 'gpt-5-mini',
    audioCaptureMode: 'microphone_system',
  } }, null, 2), { mode: 0o600 });

  let electron;
  let renderer;
  try {
    electron = spawn(packagedBinary || binary, [...(packagedBinary ? [] : [appRoot]), '--headless', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`], {
      cwd: appRoot,
      env: { ...process.env, INTELLI_CAPTURE_PROTECTION: 'off', INTELLI_STARTUP_SMOKE: '1' },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const target = await waitForPageTarget(debugPort);
    if (packagedBinary) assert.ok(target.url.includes('/app.asar/index.html'), 'testing the packaged renderer');
    renderer = new CdpClient(target.webSocketDebuggerUrl);
    await renderer.command('Runtime.enable');
    await waitUntil(() => renderer.evaluate("document.getElementById('signinBtn')?.textContent === 'Signed In'"), Boolean, 30000, 'authenticated standalone bar');

    const buyerB64 = fs.readFileSync(buyerAudioPath).toString('base64');
    const followupB64 = fs.readFileSync(followupAudioPath).toString('base64');
    await renderer.evaluate(`(async()=>{
      const metrics = window.__standaloneAudioE2E = { getUserMedia: 0, getDisplayMedia: 0, micStream: null, displayStream: null, contexts: [], sources: [] };
      async function buildAudio(encoded, toneHz, includeVideo) {
        const raw = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
        const ctx = new AudioContext({ sampleRate: 48000 });
        await ctx.resume();
        const buffer = await ctx.decodeAudioData(raw.buffer);
        const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
        const tone = ctx.createOscillator(); tone.frequency.value = toneHz;
        const gain = ctx.createGain(); gain.gain.value = 0.35;
        const destination = ctx.createMediaStreamDestination();
        source.connect(gain); tone.connect(gain); gain.connect(destination);
        source.start(); tone.start();
        const stream = destination.stream;
        if (includeVideo) {
          const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
          const videoTrack = canvas.captureStream(5).getVideoTracks()[0];
          stream.addTrack(videoTrack);
        }
        metrics.contexts.push(ctx); metrics.sources.push({ source, tone });
        return stream;
      }
      metrics.micStream = await buildAudio(${JSON.stringify(buyerB64)}, 220, false);
      metrics.displayStream = await buildAudio(${JSON.stringify(followupB64)}, 880, true);
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia?.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async () => { metrics.getUserMedia += 1; return metrics.micStream; };
      navigator.mediaDevices.getDisplayMedia = async () => { metrics.getDisplayMedia += 1; return metrics.displayStream; };
      metrics.restore = () => {
        navigator.mediaDevices.getUserMedia = originalGetUserMedia;
        if (originalGetDisplayMedia) navigator.mediaDevices.getDisplayMedia = originalGetDisplayMedia;
      };
      metrics.cleanup = async () => {
        metrics.micStream?.getTracks().forEach((track) => track.stop());
        metrics.displayStream?.getTracks().forEach((track) => track.stop());
        metrics.sources.forEach(({ source, tone }) => { try { source.stop(); } catch (_) {} try { tone.stop(); } catch (_) {} });
        for (const ctx of metrics.contexts) { if (ctx.state !== 'closed') await ctx.close(); }
      };
    })()`, true);

    await renderer.evaluate("document.getElementById('listenBtn').click()");
    await waitUntil(() => renderer.evaluate('window.__standaloneAudioE2E.getUserMedia'), (value) => value >= 1, 15000, 'microphone capture injection');
    await waitUntil(() => renderer.evaluate('window.__standaloneAudioE2E.getDisplayMedia'), (value) => value >= 1, 15000, 'display capture injection');
    await waitUntil(() => fixture.metrics.asrChunks.length >= 4, Boolean, 30000, 'mixed PCM reaches ASR');
    const bothStart = fixture.metrics.asrChunks.length;
    const bothRms = fixture.metrics.asrChunks.slice(-3).map((chunk) => chunk.rms);
    const bothTone220 = fixture.metrics.asrChunks.slice(-3).map((chunk) => chunk.tone220);
    const bothTone880 = fixture.metrics.asrChunks.slice(-3).map((chunk) => chunk.tone880);

    await renderer.evaluate("window.__standaloneAudioE2E.micStream.getAudioTracks()[0].enabled = false");
    await waitUntil(() => fixture.metrics.asrChunks.length >= bothStart + 3, Boolean, 15000, 'display-only PCM reaches ASR');
    const displayOnlyRms = fixture.metrics.asrChunks.slice(-3).map((chunk) => chunk.rms);
    const displayOnlyTone220 = fixture.metrics.asrChunks.slice(-3).map((chunk) => chunk.tone220);
    const displayOnlyTone880 = fixture.metrics.asrChunks.slice(-3).map((chunk) => chunk.tone880);

    await renderer.evaluate("window.__standaloneAudioE2E.micStream.getAudioTracks()[0].enabled = true; window.__standaloneAudioE2E.displayStream.getAudioTracks().find((track) => track.kind === 'audio').enabled = false");
    const micStart = fixture.metrics.asrChunks.length;
    await waitUntil(() => fixture.metrics.asrChunks.length >= micStart + 3, Boolean, 15000, 'microphone-only PCM reaches ASR');
    const micOnlyRms = fixture.metrics.asrChunks.slice(-3).map((chunk) => chunk.rms);
    const micOnlyTone220 = fixture.metrics.asrChunks.slice(-3).map((chunk) => chunk.tone220);
    const micOnlyTone880 = fixture.metrics.asrChunks.slice(-3).map((chunk) => chunk.tone880);
    const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    assert.ok(mean(bothRms) > 0.01, `mixed input is silent: ${mean(bothRms)}`);
    assert.ok(mean(displayOnlyRms) > 0.01, `display input disappeared when microphone was muted: ${mean(displayOnlyRms)}`);
    assert.ok(mean(micOnlyRms) > 0.01, `microphone input disappeared when display was muted: ${mean(micOnlyRms)}`);
    assert.ok(mean(bothTone220) > 0.001 && mean(bothTone880) > 0.001, 'both source markers are present in mixed PCM');
    assert.ok(mean(displayOnlyTone880) > mean(displayOnlyTone220) * 1.25, 'display marker disappeared when microphone was muted');
    assert.ok(mean(micOnlyTone220) > mean(micOnlyTone880) * 1.25, 'microphone marker disappeared when display was muted');

    await waitUntil(() => fixture.metrics.analyses >= 1, Boolean, 30000, 'automatic coaching analysis');
    await waitUntil(async () => {
      const panelResult = await renderer.evaluate('window.electronAPI.listOverlayPanels()', true);
      return Array.isArray(panelResult?.keys) && panelResult.keys.includes('ai_coach_live');
    }, Boolean, 30000, 'rendered live coaching overlay');
    await waitUntil(async () => {
      for (const target of await pageTargets(debugPort)) {
        const panel = new CdpClient(target.webSocketDebuggerUrl);
        try {
          if (await panel.evaluate("document.body?.innerText?.includes('Injected mic and display audio reached standalone coaching.')")) return true;
        } finally {
          panel.close();
        }
      }
      return false;
    }, Boolean, 30000, 'rendered coaching result');
    await renderer.evaluate("document.getElementById('listenBtn').click()");
    await waitUntil(() => renderer.evaluate("document.getElementById('listenBtn').textContent === 'Start'"), Boolean, 15000, 'standalone Stop');
    const captureState = await renderer.evaluate(`({
      getUserMedia: window.__standaloneAudioE2E.getUserMedia,
      getDisplayMedia: window.__standaloneAudioE2E.getDisplayMedia,
      micTracks: window.__standaloneAudioE2E.micStream.getTracks().map((track) => track.readyState),
      displayTracks: window.__standaloneAudioE2E.displayStream.getTracks().map((track) => track.readyState),
    })`);
    assert.equal(fixture.metrics.asrStarts, 1);
    assert.equal(fixture.metrics.asrEnds, 1);
    assert.equal(fixture.metrics.sessions.starts, 1);
    assert.equal(fixture.metrics.sessions.ends, 1);
    assert.equal(captureState.getUserMedia, 1);
    assert.equal(captureState.getDisplayMedia, 1);
    assert.ok(captureState.micTracks.every((state) => state === 'ended'), `microphone tracks not closed: ${captureState.micTracks}`);
    assert.ok(captureState.displayTracks.every((state) => state === 'ended'), `display tracks not closed: ${captureState.displayTracks}`);
    if (process.env.INTELLI_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.INTELLI_SCREENSHOT_DIR, { recursive: true });
      await renderer.command('Page.enable');
      const bar = await renderer.command('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(process.env.INTELLI_SCREENSHOT_DIR, 'standalone-bar.png'), Buffer.from(bar.data, 'base64'));
    }
    await renderer.evaluate("document.getElementById('settingsBtn').click()");
    await waitUntil(() => renderer.evaluate("document.getElementById('settingsPanel').classList.contains('show') && innerHeight > 220"), Boolean, 5000, 'expanded settings window');
    assert.equal(await renderer.evaluate("document.getElementById('saveSettingsBtn').getBoundingClientRect().bottom <= innerHeight"), true);
    assert.equal(await renderer.evaluate("document.getElementById('audioCaptureSelect').getBoundingClientRect().bottom <= innerHeight"), true);
    assert.equal(await renderer.evaluate("[...document.querySelectorAll('#settingsPanel input, #settingsPanel select')].every(el => el.getBoundingClientRect().right <= document.getElementById('settingsPanel').getBoundingClientRect().right)"), true);
    if (process.env.INTELLI_SCREENSHOT_DIR) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const settings = await renderer.command('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(process.env.INTELLI_SCREENSHOT_DIR, 'standalone-settings.png'), Buffer.from(settings.data, 'base64'));
    }
    await renderer.evaluate("document.getElementById('settingsCloseBtn').click()");
    await waitUntil(() => renderer.evaluate('innerHeight <= 220'), Boolean, 5000, 'compact settings close');
    await renderer.evaluate('window.__standaloneAudioE2E.cleanup()', true);
    process.stdout.write(`[standalone-audio-e2e] asr_starts=${fixture.metrics.asrStarts} asr_ends=${fixture.metrics.asrEnds} chunks=${fixture.metrics.asrChunks.length} analyses=${fixture.metrics.analyses} mic_capture=${captureState.getUserMedia} display_capture=${captureState.getDisplayMedia} provider_calls=0 os_system_capture=false\n`);
  } finally {
    if (renderer) renderer.close();
    if (electron && electron.exitCode === null && !electron.signalCode) electron.kill('SIGTERM');
    if (electron) await waitForChildExit(electron);
    await fixture.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});
