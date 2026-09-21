/*
 * Opt-in end-to-end check for the hosted Electron runtime.
 *
 * The test is intentionally skipped unless RUN_INTELLI_VOICE_E2E=1.  It uses
 * the external Kokoro corpus and real local DynamoDB/Redis plus provider
 * credentials loaded in memory from the developer's primary .env file.  No
 * credential, token, transcript, or provider response is written to disk.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const WebSocket = require('ws');

const appRoot = path.resolve(__dirname, '..');
const backendRoot = '/Users/trevormartin/.codex/worktrees/laserreach-visibility-calling/backend';
const pythonBin = '/tmp/laserreach-visibility-py311/bin/python';
const corpusRoot = '/Users/trevormartin/Projects/laserreach/output/calling-validation-20260920';
const audioPath = path.join(corpusRoot, 'buyer.wav');
const primaryEnvPath = '/Users/trevormartin/Projects/laserreach/laserreach/.env';
const runEnabled = process.env.RUN_INTELLI_VOICE_E2E === '1';

function parseDotenv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

function privateProviderEnv() {
  const fileEnv = parseDotenv(primaryEnvPath);
  const env = { ...process.env };
  for (const key of ['DEEPGRAM_KEY', 'DEEPGRAM_API_KEY', 'OPENAI_API_KEY']) {
    if (!env[key] && fileEnv[key]) env[key] = fileEnv[key];
  }
  return env;
}

function findElectronBinary() {
  if (process.env.INTELLI_ELECTRON_BIN && fs.existsSync(process.env.INTELLI_ELECTRON_BIN)) {
    return process.env.INTELLI_ELECTRON_BIN;
  }
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

async function waitForHttp(url, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          res.resume();
          res.once('end', () => (res.statusCode && res.statusCode < 599 ? resolve() : reject(new Error(`HTTP ${res.statusCode}`))));
        });
        req.once('error', reject);
        req.setTimeout(1500, () => req.destroy(new Error('timeout')));
      });
      return;
    } catch (_) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
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
  throw new Error(`Timed out waiting for TCP port ${port}`);
}

function waitForChildExit(child, timeoutMs = 10000) {
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

function summarizeBackendOutput(output) {
  return String(output || '')
    .split(/\r?\n/)
    .filter((line) => /Intelli analysis WS|AI gateway route failed|capture_protection_mode|startup smoke/i.test(line))
    .map((line) => line
      .replace(/(?:sk|AIza|Token)\S+/gi, '[redacted]')
      .replace(/(AI gateway route failed provider=[^:]+):.*/, '$1: [error detail redacted]'))
    .slice(-12);
}

function signJwt(secret, subject) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: subject,
    type: 'access',
    fresh: false,
    iat: now,
    nbf: now,
    jti: crypto.randomUUID(),
    exp: now + 3600,
    csrf: crypto.randomBytes(16).toString('hex'),
    '2fa_passed': true,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode(header)}.${encode(payload)}`;
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function seedFixtures(env, values, cleanup = false) {
  const script = String.raw`
import os
import boto3

endpoint = os.environ.get("DDB_LOCAL_ENDPOINT", "http://127.0.0.1:8000")
ddb = boto3.resource("dynamodb", endpoint_url=endpoint, region_name="us-east-2", aws_access_key_id="e2e", aws_secret_access_key="e2e")
tenant = os.environ["E2E_TENANT"]
user = os.environ["E2E_USER"]
pipeline = os.environ["E2E_PIPELINE"]
person = os.environ["E2E_PERSON"]
company = os.environ["E2E_COMPANY"]
items = [
    ("users3", {"username": user, "email": user + "@example.invalid"}),
    ("organizations3", {"org_id": tenant, "name": "Intelli E2E Workspace", "owner": user}),
    ("abm_iam", {"PK": "ORG#" + tenant, "SK": "MEMB#" + user, "Type": "Membership", "username": user, "role_ids": ["owner"], "effective_permissions": ["*"], "status": "active", "GSI1PK": "USER#" + user, "GSI1SK": "ORG#" + tenant + "#MEMB"}),
    ("abm_people", {"tenant_id": tenant, "person_id": person, "full_name": "Jordan Buyer", "name": "Jordan Buyer", "title": "VP Revenue", "email": "jordan.buyer@example.invalid", "company_id": company}),
    ("abm_companies", {"tenant_id": tenant, "company_id": company, "name": "Acme Vector", "industry": "Revenue technology", "website": "https://acme-vector.invalid"}),
    ("abm_pipelines", {"tenant_id": tenant, "pipeline_id": pipeline, "person_id": person, "company_id": company, "status": "active", "current_step": 1, "steps": [{"type": "call", "status": "scheduled", "data": {"topic": "revenue intelligence"}}]}),
]
for table_name, item in items:
    table = ddb.Table(table_name)
    if ${cleanup ? 'True' : 'False'}:
        schema = table.key_schema
        table.delete_item(Key={part["AttributeName"]: item[part["AttributeName"]] for part in schema})
    else:
        table.put_item(Item=item)
if ${cleanup ? 'True' : 'False'}:
    for table_name, item in items:
        table = ddb.Table(table_name)
        schema = table.key_schema
        key = {part["AttributeName"]: item[part["AttributeName"]] for part in schema}
        if table.get_item(Key=key, ConsistentRead=True).get("Item"):
            raise RuntimeError(f"fixture cleanup verification failed: {table_name}")
`;
  const result = spawnSync(pythonBin, ['-c', script], {
    cwd: backendRoot,
    env: { ...env, DDB_LOCAL_ENDPOINT: 'http://127.0.0.1:8000', AWS_ENDPOINT_URL_DYNAMODB: 'http://127.0.0.1:8000', AWS_DEFAULT_REGION: 'us-east-2', DYNAMODB_REGION: 'us-east-2', ...values },
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`fixture ${cleanup ? 'cleanup' : 'seed'} failed (${result.status})`);
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

async function waitUntil(read, predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function readPcm16Wav(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bits = buffer.readUInt16LE(34);
  assert.equal(channels, 1);
  assert.equal(bits, 16);
  let offset = 12;
  let dataStart = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    if (id === 'data') { dataStart = offset + 8; dataLength = length; break; }
    offset += 8 + length + (length % 2);
  }
  assert.ok(dataStart >= 0, 'WAV data chunk is present');
  const pcm = new Float32Array(Math.floor(dataLength / 2));
  for (let i = 0; i < pcm.length; i += 1) pcm[i] = buffer.readInt16LE(dataStart + i * 2) / 32768;
  return { sampleRate, pcm };
}

async function runVoiceE2E() {
  assert.ok(fs.existsSync(audioPath), `generated corpus missing: ${audioPath}`);
  assert.ok(fs.existsSync(pythonBin), `runtime missing: ${pythonBin}`);
  const privateEnv = privateProviderEnv();
  const missing = [];
  if (!privateEnv.DEEPGRAM_KEY && !privateEnv.DEEPGRAM_API_KEY) missing.push('DEEPGRAM_KEY or DEEPGRAM_API_KEY');
  if (!privateEnv.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
  if (missing.length) throw new Error(`actual provider configuration unavailable: missing ${missing.join(', ')}`);
  const redisPort = await freePort();
  const backendPort = await freePort();
  const debugPort = await freePort();
  const fixture = {
    tenant: `e2e-intelli-${crypto.randomUUID()}`,
    user: `e2e-user-${crypto.randomUUID()}`,
    pipeline: `e2e-pipeline-${crypto.randomUUID()}`,
    person: `e2e-person-${crypto.randomUUID()}`,
    company: `e2e-company-${crypto.randomUUID()}`,
  };
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  const token = signJwt(jwtSecret, fixture.user);
  const redis = spawn('redis-server', ['--port', String(redisPort), '--save', '', '--appendonly', 'no'], {
    cwd: appRoot,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const backendEnv = {
    ...privateEnv,
    TEST_MODE: '1',
    RBAC_ENFORCE: 'false',
    APP_HOST: '127.0.0.1',
    APP_STARTUP_WORKERS_MODE: 'disabled',
    APP_STARTUP_SENDER_WORKER_MODE: 'disabled',
    SCRAPY_PROCESS_MODE: 'disabled',
    LASERREACH_SCRAPY_PROCESS_MODE: 'disabled',
    AUTO_RESUME_LEGACY_CAMPAIGNS: 'false',
    TEST_MODE_REDIS_HOST: '127.0.0.1',
    TEST_MODE_REDIS_PORT: String(redisPort),
    // Legacy helper modules choose their non-cluster branch only for this
    // hostname; hosted sessions still use the isolated TEST_MODE Redis port.
    REDIS_HOST: 'localhost',
    REDIS_PASSWORD: '',
    DDB_LOCAL_ENDPOINT: 'http://127.0.0.1:8000',
    AWS_ENDPOINT_URL_DYNAMODB: 'http://127.0.0.1:8000',
    AWS_DEFAULT_REGION: 'us-east-2',
    DYNAMODB_REGION: 'us-east-2',
    AWS_ACCESS_KEY_ID: 'e2e',
    AWS_SECRET_ACCESS_KEY: 'e2e',
    AWS_EC2_METADATA_DISABLED: 'true',
    AI_GATEWAY_MONTHLY_BUDGET_USD: '2',
    JWT_SECRET_KEY: jwtSecret,
    PORT: String(backendPort),
  };
  // flask_sockets' Intelli endpoints require the repository's gevent WebSocket
  // worker; Werkzeug serves the HTTP health route but answers WS upgrades 404.
  const backend = spawn(pythonBin, ['-m', 'gunicorn', '-k', 'customworker.CustomGeventWebSocketWorker', '-w', '1', '--bind', `127.0.0.1:${backendPort}`, '--access-logfile', '-', '--error-logfile', '-', 'app:app'], {
    cwd: backendRoot,
    env: backendEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let backendOutput = '';
  backend.stdout.on('data', (chunk) => { backendOutput += chunk.toString(); });
  backend.stderr.on('data', (chunk) => { backendOutput += chunk.toString(); });
  let renderer;
  let profileDir;
  let electron;
  let outcome;
  let primaryError;
  let cleanupError;
  try {
    await waitForTcp(redisPort);
    try {
      await waitForHttp(`http://127.0.0.1:${backendPort}/`);
    } catch (error) {
      const safeTail = backendOutput.slice(-3000).replace(/(?:sk|AIza|Token)\S+/gi, '[redacted]');
      throw new Error(`${error.message}; backend_state=${backend.exitCode === null ? 'running' : `exit:${backend.exitCode}`}; tail=${safeTail}`);
    }
    seedFixtures(backendEnv, {
      E2E_TENANT: fixture.tenant,
      E2E_USER: fixture.user,
      E2E_PIPELINE: fixture.pipeline,
      E2E_PERSON: fixture.person,
      E2E_COMPANY: fixture.company,
    });

    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laserreach-intelli-e2e-'));
    fs.writeFileSync(path.join(profileDir, 'settings.json'), JSON.stringify({ hosted: {
      backendUrl: `http://127.0.0.1:${backendPort}`,
      frontendUrl: `http://127.0.0.1:${backendPort}`,
      tenantId: fixture.tenant,
      jwtToken: token,
      analysisModel: 'gpt-5-mini',
      lookaheadMinutes: 30,
      defaultPipelineId: fixture.pipeline,
    } }, null, 2), { mode: 0o600 });
    const binary = findElectronBinary();
    assert.ok(binary, 'Electron binary is installed');
    electron = spawn(binary, [appRoot, '--headless', '--disable-gpu', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`], {
      cwd: appRoot,
      env: { ...process.env, INTELLI_CAPTURE_PROTECTION: 'off', INTELLI_STARTUP_SMOKE: '1' },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const target = await waitForPageTarget(debugPort);
    renderer = new CdpClient(target.webSocketDebuggerUrl);
    await renderer.evaluate(`(() => {
      window.__intelliE2E = { asr: [], analysis: [], status: [] };
      window.electronAPI.onASRMessage((msg) => window.__intelliE2E.asr.push(msg));
      window.electronAPI.onAnalysisResponse((event) => window.__intelliE2E.analysis.push(event && event.data ? event.data : event));
      window.electronAPI.onStatus((msg) => window.__intelliE2E.status.push({ ...msg, observed_at: Date.now() }));
      return true;
    })()`);
    const config = await renderer.evaluate('window.electronAPI.getHostedConfig()', true);
    const hostedConfig = config?.config || config;
    assert.equal(hostedConfig?.tenantId, fixture.tenant, `hosted config keys=${Object.keys(config || {}).join(',')}; config keys=${Object.keys(config?.config || {}).join(',')}`);
    const auth = await renderer.evaluate('window.electronAPI.authListOrgs()', true);
    assert.ok(auth?.success, `Electron auth/org IPC reaches loopback backend: ${JSON.stringify({ keys: Object.keys(auth || {}), error: auth?.error || '' })}`);
    assert.ok((auth.orgs || []).some((org) => org.org_id === fixture.tenant));

    const sessionId = `e2e-session-${crypto.randomUUID()}`;
    await renderer.evaluate(`window.electronAPI.sessionStart(${JSON.stringify(sessionId)}, ${JSON.stringify({ pipeline_id: fixture.pipeline, event_id: `${fixture.pipeline}_call` })})`);
    await new Promise((resolve) => setTimeout(resolve, 750));
    const wav = readPcm16Wav(audioPath);
    await renderer.evaluate(`window.electronAPI.asrStart({ sampleRate: ${wav.sampleRate}, updateMs: 700 })`);
    try {
      await waitUntil(() => renderer.evaluate('window.__intelliE2E.asr'), (messages) => messages.some((msg) => msg.op === 'status' && msg.message === 'stream_started'), 25000, 'Deepgram stream startup');
    } catch (error) {
      const observed = await renderer.evaluate('window.__intelliE2E.asr.map((msg) => ({ op: msg.op, message: msg.message || "", provider: msg.provider || "" }))');
      const safeTail = backendOutput.slice(-2500).replace(/(?:sk|AIza|Token)\S+/gi, '[redacted]');
      throw new Error(`${error.message}; observed=${JSON.stringify(observed)}; backend_tail=${safeTail}`);
    }
    for (let offset = 0; offset < wav.pcm.length; offset += 4096) {
      const chunk = Array.from(wav.pcm.subarray(offset, Math.min(offset + 4096, wav.pcm.length)));
      await renderer.evaluate(`window.electronAPI.asrSendChunkF32(new Float32Array(${JSON.stringify(chunk)}))`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await renderer.evaluate('window.electronAPI.asrStop()');
    const asrMessages = await waitUntil(() => renderer.evaluate('window.__intelliE2E.asr'), (messages) => messages.some((msg) => msg.op === 'transcript' && msg.text), 30000, 'Deepgram final transcription');
    assert.equal(asrMessages.some((msg) => msg.op === 'error'), false, 'ASR stream has no provider error');
    const transcript = asrMessages.filter((msg) => msg.op === 'transcript' && msg.text).map((msg) => msg.text).join(' ').trim();
    assert.ok(transcript.length > 10, 'Electron received a non-empty Deepgram transcript');
    const normalizedTranscript = transcript.toLowerCase();
    assert.ok(normalizedTranscript.includes('follow') && normalizedTranscript.includes('sales'), 'Deepgram transcript contains the generated buyer scenario');
    await renderer.evaluate(`window.electronAPI.sessionAppendTranscript(${JSON.stringify(sessionId)}, ${JSON.stringify({ text: transcript, ts: new Date().toISOString() })})`);

    const analysisId = `e2e-analysis-${crypto.randomUUID()}`;
    const analysisStartedAt = Date.now();
    await renderer.evaluate(`window.electronAPI.sendAnalysisRequest(${JSON.stringify({
      id: analysisId,
      transcript,
      prompt: 'Use the supplied Acme Vector account context and transcript. Give one concrete coaching action grounded in observed evidence. Return JSON only.',
      analysisType: 'summary',
      model: 'gpt-5-mini',
      pipelineId: fixture.pipeline,
      eventId: `${fixture.pipeline}_call`,
    })})`);
    let analysis;
    try {
      analysis = await waitUntil(
        () => renderer.evaluate('window.__intelliE2E.analysis'),
        (messages) => messages.find((msg) => msg.id === analysisId),
        180000,
        'OpenAI analysis response',
      );
    } catch (error) {
      const observed = await renderer.evaluate(`({
        statuses: window.__intelliE2E.status
          .filter((msg) => Number(msg.observed_at || 0) >= ${analysisStartedAt})
          .map((msg) => ({ requestId: msg.requestId || '', type: msg.type || '', status: msg.status || '', message: msg.message || '' })),
        analysis: window.__intelliE2E.analysis
          .filter((msg) => msg.id === ${JSON.stringify(analysisId)})
          .map((msg) => ({ id: msg.id || '', type: msg.type || '', error: msg.error ? String(msg.error).slice(0, 240) : '' })),
      })`);
      const phase = observed.statuses.some((msg) => msg.status === 'running')
        ? 'backend accepted analyze and remains inside context/provider work'
        : observed.statuses.length
          ? 'analysis status reached Electron without a running phase'
          : 'no analysis status reached Electron after IPC send';
      throw new Error(`${error.message}; phase=${phase}; observed=${JSON.stringify(observed)}; backend_state=${backend.exitCode === null ? 'running' : `exit:${backend.exitCode}`}; backend_logs=${JSON.stringify(summarizeBackendOutput(backendOutput))}`);
    }
    const result = analysis.find((msg) => msg.id === analysisId);
    const analysisError = String(result?.error || '');
    const errorClass = analysisError.includes('401') || /authentication|api.?key/i.test(analysisError)
      ? 'provider_authentication'
      : analysisError ? 'provider_request' : '';
    assert.equal(result?.error, undefined, errorClass ? `analysis provider request failed: ${errorClass}` : 'analysis returned an error');
    assert.ok(result?.raw?.usage && Number(result.raw.usage.total_tokens) > 0, 'analysis includes provider usage');
    assert.equal(result?.raw?.context?.pipeline_id, fixture.pipeline);
    assert.equal(result?.raw?.context?.person?.full_name, 'Jordan Buyer');
    assert.equal(result?.raw?.context?.company?.name, 'Acme Vector');
    const coachingText = JSON.stringify(result.raw?.parsed || result.results || result.raw?.text || '').toLowerCase();
    assert.ok(/follow|next.?step|owner|summary|workflow/.test(coachingText), 'coaching contains a scenario-specific action');
    const storedAnalysisEntry = { ts: new Date().toISOString(), results: result.raw?.parsed || result.results || result.raw?.text };
    await renderer.evaluate(`window.electronAPI.sessionAppendAnalysis(${JSON.stringify(sessionId)}, ${JSON.stringify(storedAnalysisEntry)})`);
    await new Promise((resolve) => setTimeout(resolve, 750));
    await renderer.evaluate(`window.electronAPI.sessionEnd(${JSON.stringify(sessionId)}, ${JSON.stringify({ ended_at: new Date().toISOString(), transcript_len: transcript.length })})`);
    await new Promise((resolve) => setTimeout(resolve, 750));
    const stored = await renderer.evaluate(`window.electronAPI.getSession(${JSON.stringify(sessionId)})`, true);
    assert.equal(stored?.success, true, 'separate session read succeeds');
    assert.equal(stored?.session?.tenant_id, fixture.tenant);
    assert.ok(stored?.session?.ended_at, 'session teardown persisted');
    const savedTranscript = (stored.session.events || []).find((event) => event.type === 'transcript');
    const savedAnalysis = (stored.session.events || []).find((event) => event.type === 'analysis');
    assert.ok(savedTranscript, 'session stores the received transcript');
    assert.equal(savedTranscript.payload?.text, transcript);
    assert.ok(savedAnalysis, 'session stores the coaching result');
    assert.deepEqual(savedAnalysis.payload?.results, storedAnalysisEntry.results);
    outcome = { transcriptLength: transcript.length, usage: result.raw.usage, eventCount: stored.session.events.length };
  } catch (error) {
    primaryError = error;
  } finally {
    if (renderer) renderer.close();
    if (electron && electron.exitCode === null && !electron.signalCode) electron.kill('SIGTERM');
    if (electron) await waitForChildExit(electron);
    if (backend && backend.exitCode === null && !backend.signalCode) backend.kill('SIGTERM');
    if (backend) await waitForChildExit(backend);
    if (redis && redis.exitCode === null && !redis.signalCode) redis.kill('SIGTERM');
    if (redis) await waitForChildExit(redis, 3000);
    try {
      seedFixtures(backendEnv, {
        E2E_TENANT: fixture.tenant,
        E2E_USER: fixture.user,
        E2E_PIPELINE: fixture.pipeline,
        E2E_PERSON: fixture.person,
        E2E_COMPANY: fixture.company,
      }, true);
    } catch (error) {
      cleanupError = error;
    }
    if (profileDir) fs.rmSync(profileDir, { recursive: true, force: true });
  }
  if (cleanupError) {
    const cleanupMessage = `fixture cleanup failed: ${cleanupError.message}`;
    if (primaryError) primaryError.message = `${primaryError.message}; ${cleanupMessage}`;
    else primaryError = new Error(cleanupMessage);
  }
  if (primaryError) throw primaryError;
  return outcome;
}

test('generated voice reaches hosted ASR, context coaching, and durable session read', {
  skip: runEnabled ? false : 'set RUN_INTELLI_VOICE_E2E=1 to authorize the provider-backed local E2E',
  timeout: 240000,
}, async () => {
  const evidence = await runVoiceE2E();
  assert.ok(evidence.transcriptLength > 10);
  process.stdout.write(`[intelli-e2e] transcript_chars=${evidence.transcriptLength} session_events=${evidence.eventCount} provider_total_tokens=${evidence.usage.total_tokens}\n`);
});
