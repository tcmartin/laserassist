/*
 * Real Electron -> CallSignaling -> registered backend media route.
 *
 * The backend bootstrap replaces only the trusted Janus factory with a local
 * fake adapter. DynamoDB/Redis, JWT authorization, Flask-Sockets, the durable
 * call store, controller, native worker, Electron IPC, and cleanup remain real.
 * No Janus, SIP, payment, ASR, or completion provider is contacted.
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
  throw new Error(`Timed out waiting for TCP ${port}`);
}

async function waitForHttp(url, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          res.resume();
          res.once('end', () => (res.statusCode && res.statusCode < 599
            ? resolve() : reject(new Error(`HTTP ${res.statusCode}`))));
        });
        req.once('error', reject);
        req.setTimeout(1500, () => req.destroy(new Error('timeout')));
      });
      return;
    } catch (_) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startAudioProxy(backendPort, answerPath) {
  const asr = new WebSocket.Server({ noServer: true });
  const analysis = new WebSocket.Server({ noServer: true });
  const metrics = { asrStarts: 0, asrChunks: 0, asrMaxAbs: 0, asrEnds: 0, analyses: 0, answerWrites: 0 };
  const respond = (socket, message) => socket.send(JSON.stringify(message));
  asr.on('connection', (socket) => socket.on('message', (raw) => {
    let message; try { message = JSON.parse(String(raw)); } catch (_) { return; }
    if (message.op === 'stream_start') {
      metrics.asrStarts += 1;
      respond(socket, { success: true, request_id: message.request_id, stream_id: 'fake-asr' });
    } else if (message.op === 'audio_chunk') {
      metrics.asrChunks += 1;
      try {
        const pcm = Buffer.from(String(message.audio_b64 || ''), 'base64');
        for (let i = 0; i + 1 < pcm.length; i += 2) metrics.asrMaxAbs = Math.max(metrics.asrMaxAbs, Math.abs(pcm.readInt16LE(i)) / 32768);
      } catch (_) {}
      if (metrics.asrChunks === 1) respond(socket, {
        op: 'transcript_event', text: 'The buyer needs a clear implementation timeline, a named owner, and a follow up date for the next step.',
        is_final: true, speech_final: true, provider: 'fake-asr', confidence: 0.99,
      });
    } else if (message.op === 'stream_end') {
      metrics.asrEnds += 1;
      respond(socket, { success: true, request_id: message.request_id });
    }
  }));
  analysis.on('connection', (socket) => socket.on('message', (raw) => {
    let message; try { message = JSON.parse(String(raw)); } catch (_) { return; }
    if (message.op === 'analyze') {
      metrics.analyses += 1;
      respond(socket, { success: true, request_id: message.request_id, op: 'analysis_result', parsed: {
        summary: 'Buyer needs a clear implementation timeline.',
        actionItems: ['Confirm the implementation owner and timeline.'],
        questions: ['Who owns the next step?'], topics: ['Implementation timeline'],
      }, text: 'fake coaching result' });
    } else if (['session_start', 'session_append', 'session_end'].includes(message.op)) {
      respond(socket, { success: true, request_id: message.request_id, event_count: 1 });
    }
  }));

  const server = http.createServer((req, res) => {
    if (req.url === '/e2e-answer' && req.method === 'POST') {
      let raw = ''; req.setEncoding('utf8'); req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        try {
          const answer = JSON.parse(raw);
          if (answer?.type !== 'answer' || typeof answer.sdp !== 'string' || answer.sdp.length > 200000) throw new Error('invalid answer');
          fs.writeFileSync(answerPath, JSON.stringify({ type: answer.type, sdp: answer.sdp }), { mode: 0o600 });
          metrics.answerWrites += 1; res.writeHead(204); res.end();
        } catch (_) { res.writeHead(400); res.end(); }
      });
      return;
    }
    const upstream = http.request({ hostname: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers: req.headers }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers); upstreamRes.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const target = pathname.endsWith('/transcribe/ws') ? asr : pathname.endsWith('/analyze/ws') ? analysis : null;
    if (target) { target.handleUpgrade(req, socket, head, (client) => target.emit('connection', client, req)); return; }
    if (!pathname.includes('/media/ws')) { socket.destroy(); return; }
    const upstream = new WebSocket(`ws://127.0.0.1:${backendPort}${req.url}`);
    const pending = [];
    let browserSocket = null;
    upstream.on('open', () => { while (pending.length) upstream.send(pending.shift()); });
    const client = new WebSocket.Server({ noServer: true });
    client.handleUpgrade(req, socket, head, (browser) => {
      browserSocket = browser;
      browser.on('message', (message) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(message); else pending.push(message);
      });
      browser.on('close', () => { try { upstream.close(); } catch (_) {} });
      upstream.on('close', () => { try { browser.close(); } catch (_) {} });
    });
    upstream.on('message', (message) => { if (browserSocket?.readyState === WebSocket.OPEN) browserSocket.send(message); });
  });
  return { server, metrics, listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)), close: () => new Promise((resolve) => { asr.close(); analysis.close(); server.close(resolve); }) };
}

function waitForChildExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    const done = () => { clearTimeout(timer); resolve(); };
    child.once('exit', done);
    timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, timeoutMs);
  });
}

function signJwt(secret, subject) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: subject, type: 'access', fresh: false, iat: now, nbf: now, exp: now + 3600,
    jti: crypto.randomUUID(), csrf: crypto.randomBytes(16).toString('hex'), '2fa_passed': true,
  })).toString('base64url');
  const body = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function runPython(script, env) {
  const result = spawnSync(pythonBin, ['-c', script], {
    cwd: backendRoot, env, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Python fixture failed (${result.status}): ${result.stderr}`);
  return result.stdout.trim();
}

function setupDdb(env) {
  const result = spawnSync(pythonBin, [
    'scripts/setup_local_dynamodb.py', '--region', 'us-east-2', '--endpoint', env.DDB_LOCAL_ENDPOINT,
  ], { cwd: backendRoot, env, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`DynamoDB bootstrap failed: ${result.stderr}`);
  const calling = spawnSync(pythonBin, [
    'scripts/create_intelli_calling_table.py', '--table-name', 'abm_intelli_calling',
  ], { cwd: backendRoot, env, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (calling.status !== 0) throw new Error(`Intelli calling table bootstrap failed: ${calling.stderr}`);
}

function seedCalls(env, tenant, actor) {
  const script = String.raw`
import copy, json, os, boto3
from abm.intelli_call_scripts import CallScriptStore
from abm.intelli_call_sessions import CallSessionStore

tenant, actor = os.environ["E2E_TENANT"], os.environ["E2E_USER"]
db = boto3.resource("dynamodb", endpoint_url=os.environ["DDB_LOCAL_ENDPOINT"], region_name="us-east-2", aws_access_key_id="e2e", aws_secret_access_key="e2e")
table = db.Table("abm_intelli_calling")
scripts = CallScriptStore(table)
script = scripts.create(tenant, actor, {"title": "Dialer E2E", "opening": "Hello {{person.full_name}}."})
asset = {"tenant_id": tenant, "record_id": "number#caller-e2e", "number_id": "caller-e2e", "number": "+12025550102", "status": "active", "local_only": True, "provider": "janus_sip", "account_ref": "fake-account"}
table.put_item(Item=asset)
users = db.Table("users3")
users.put_item(Item={"username": actor})
users.put_item(Item={"username": os.environ["E2E_FOREIGN"]})
people = db.Table("abm_people")
people.put_item(Item={"tenant_id": tenant, "person_id": "person-e2e", "full_name": "Dialer Buyer", "name": "Dialer Buyer", "title": "VP Revenue", "email": "buyer@example.test", "company_id": "company-e2e", "phone_number": "+12025550101"})
context = {"tenant_id": tenant, "context_snapshot_id": "snapshot-e2e", "person_id": "person-e2e", "person": {"person_id": "person-e2e", "full_name": "Dialer Buyer", "email": "buyer@example.test"}, "company": {"name": "Acme Vector"}, "phone_candidates": [{"number_id": "destination-e2e", "number": "+12025550101", "eligible": True}]}
store = CallSessionStore(table, context_resolver=lambda *_args, **_kwargs: copy.deepcopy(context), scripts=scripts, number_loader=lambda *_args: copy.deepcopy(asset), provider_loader=lambda *_args: None, local_numbers={"caller-e2e"})
request = {"person_id": "person-e2e", "context_snapshot_id": "snapshot-e2e", "number_id": "destination-e2e", "caller_number_id": "caller-e2e", "script_template_id": script["template_id"], "script_revision": 1, "mode": "local_test", "confirmed": True, "idempotency_key": "dialer-e2e-" + os.environ["E2E_SUFFIX"]}
rows = [store.prepare(tenant, actor, {**request, "idempotency_key": request["idempotency_key"] + "-active"}), store.prepare(tenant, actor, {**request, "idempotency_key": request["idempotency_key"] + "-disconnect"})]
print(json.dumps({"call_ids": [row["call_id"] for row in rows], "script_id": script["template_id"]}))
`;
  return JSON.parse(runPython(script, { ...env, E2E_TENANT: tenant, E2E_USER: actor, E2E_FOREIGN: env.E2E_FOREIGN, E2E_SUFFIX: crypto.randomUUID() }));
}

function cleanupCalls(env, tenant, values) {
  const script = String.raw`
import os, boto3
db = boto3.resource("dynamodb", endpoint_url=os.environ["DDB_LOCAL_ENDPOINT"], region_name="us-east-2", aws_access_key_id="e2e", aws_secret_access_key="e2e")
table = db.Table("abm_intelli_calling")
tenant = os.environ["E2E_TENANT"]
from boto3.dynamodb.conditions import Key
cursor = None
while True:
    kwargs = {"KeyConditionExpression": Key("tenant_id").eq(tenant), "ConsistentRead": True}
    if cursor:
        kwargs["ExclusiveStartKey"] = cursor
    page = table.query(**kwargs)
    for row in page.get("Items", []):
        table.delete_item(Key={"tenant_id": tenant, "record_id": row["record_id"]})
    cursor = page.get("LastEvaluatedKey")
    if not cursor:
        break
users = db.Table("users3")
users.delete_item(Key={"username": os.environ["E2E_USER"]})
users.delete_item(Key={"username": os.environ["E2E_FOREIGN"]})
db.Table("abm_people").delete_item(Key={"tenant_id": tenant, "person_id": "person-e2e"})
`;
  runPython(script, { ...env, E2E_TENANT: tenant, E2E_USER: env.E2E_USER, E2E_FOREIGN: env.E2E_FOREIGN, E2E_CALL_IDS: values.call_ids.join(','), E2E_SCRIPT_ID: values.script_id });
}

function readCallState(env, tenant, callId) {
  const script = String.raw`
import json, os, boto3
db = boto3.resource("dynamodb", endpoint_url=os.environ["DDB_LOCAL_ENDPOINT"], region_name="us-east-2", aws_access_key_id="e2e", aws_secret_access_key="e2e")
row = db.Table("abm_intelli_calling").get_item(Key={"tenant_id": os.environ["E2E_TENANT"], "record_id": "call#" + os.environ["E2E_CALL_ID"]}, ConsistentRead=True).get("Item")
print(json.loads(row["body"]).get("state") if row else "")
`;
  return runPython(script, { ...env, E2E_TENANT: tenant, E2E_CALL_ID: callId });
}

function backendBootstrapScript() {
  return String.raw`
import json, os, threading
import helpers.rbac_middleware as rbac_middleware
import helpers.rbac as rbac
from flask import g, request

def _test_authorize(*_args, **_kwargs):
    return True
def _test_rbac_require(**_kwargs):
    def decorate(fn):
        def wrapped(*args, **kwargs):
            g.laserreach_authorized_org_id = request.headers.get("X-Org-ID") or ""
            return fn(*args, **kwargs)
        wrapped.__name__ = fn.__name__
        return wrapped
    return decorate
rbac_middleware.authorize = _test_authorize
rbac.authorize = _test_authorize
rbac_middleware.rbac_require = _test_rbac_require
from routes import intelli_session_routes, intelli_media_socket

def context_resolver(tenant_id, **_kwargs):
    return {"tenant_id": tenant_id, "context_snapshot_id": "snapshot-e2e", "person_id": "person-e2e", "person": {"person_id": "person-e2e", "full_name": "Dialer Buyer", "email": "buyer@example.test"}, "company": {"name": "Acme Vector"}, "phone_candidates": [{"number_id": "destination-e2e", "number": "+12025550101", "eligible": True}]}
intelli_session_routes.resolve_call_context = context_resolver
from routes import intelli_calling_routes
intelli_calling_routes.resolve_call_context = context_resolver
state_path = os.environ["E2E_PROVIDER_STATE"]
answer_path = os.environ["E2E_ANSWER_PATH"]
offer_path = os.environ["E2E_OFFER_PATH"]
lock = threading.Lock()
def read_state():
    try:
        with open(state_path, encoding="utf-8") as stream:
            return json.load(stream)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"starts": 0, "ends": 0, "closes": 0, "calls": {}}
def write_state(state):
    temporary = state_path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as stream:
        json.dump(state, stream, sort_keys=True)
    os.replace(temporary, state_path)
def mutate(call_id, action, state="connected"):
    with lock:
        current = read_state()
        current.setdefault("calls", {}).setdefault(call_id, {})["state"] = state
        current[action] = int(current.get(action, 0)) + 1
        write_state(current)
class FakeAdapter:
    local_test = True
    def __init__(self, _asset):
        self.call_id = None
        self.polled = False
    def start(self, record, offer):
        assert offer["type"] == "offer" and "m=audio " in offer["sdp"]
        self.call_id = record["call_id"]
        with open(offer_path, "w", encoding="utf-8") as stream:
            json.dump({"type": offer["type"], "sdp": offer["sdp"]}, stream)
        mutate(self.call_id, "starts")
        return {"provider_call_id": "fake-provider-" + self.call_id[-12:], "state": "dialing"}
    def trickle(self, candidate):
        assert candidate is None or isinstance(candidate, dict)
        return {"accepted": True}
    def poll(self, _timeout):
        if not self.polled:
            try:
                with open(answer_path, encoding="utf-8") as stream:
                    answer = json.load(stream)
            except (FileNotFoundError, json.JSONDecodeError):
                return {"events": [], "state": "dialing"}
            self.polled = True
            return {"events": [{"type": "accepted", "state": "connected", "jsep": answer}], "state": "connected"}
        return {"events": [], "state": "connected"}
    def inspect(self, _record):
        return {"provider_call_id": "fake-provider-" + self.call_id[-12:], "state": "connected"}
    def end(self, _record):
        mutate(self.call_id, "ends", "ended")
        return True
    def close(self):
        mutate(self.call_id, "closes", "ended")
def fake_controller_factory(tenant_id, actor_id, call_id):
    from abm.intelli_call_media import CallMediaController
    from routes.intelli_session_routes import session_store
    store = session_store()
    return CallMediaController(tenant_id, actor_id, call_id, store, lambda asset: FakeAdapter(asset))
intelli_media_socket._default_controller_factory = fake_controller_factory
from app import app
`;
}

function findElectronBinary() {
  const packageRoot = path.dirname(require.resolve('electron'));
  const candidate = process.platform === 'darwin'
    ? path.join(packageRoot, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : path.join(packageRoot, 'dist', 'electron');
  return fs.existsSync(candidate) ? candidate : null;
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
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, awaitPromise = false) {
    const result = await this.command('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
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

test('actual index dialer sends generated buyer audio through media, ASR and coaching hooks', {
  skip: process.env.RUN_INTELLI_DIALER_AUDIO_E2E === '1' ? false : 'set RUN_INTELLI_DIALER_AUDIO_E2E=1 for local audio diagnostic',
  timeout: 120000,
}, async () => {
  assert.ok(fs.existsSync(pythonBin), 'pinned Python runtime is installed');
  const binary = findElectronBinary(); assert.ok(binary, 'Electron binary is installed');
  const wavPath = process.env.INTELLI_TEST_VOICE || '/Users/trevormartin/Projects/laserreach/output/calling-validation-20260920/buyer.wav';
  assert.ok(fs.existsSync(wavPath), 'generated buyer.wav exists');
  const backendPort = await freePort(); const redisPort = await freePort(); const debugPort = await freePort();
  const tenant = `dialer-audio-${crypto.randomUUID()}`; const actor = `dialer-user-${crypto.randomUUID()}`; const foreign = `dialer-foreign-${crypto.randomUUID()}`;
  const jwtSecret = crypto.randomBytes(32).toString('hex'); const token = signJwt(jwtSecret, actor);
  const ddbEndpoint = process.env.DDB_LOCAL_ENDPOINT || 'http://127.0.0.1:8000';
  const baseEnv = { ...process.env, TEST_MODE: '1', RBAC_ENFORCE: 'false', APP_HOST: '127.0.0.1', APP_STARTUP_WORKERS_MODE: 'disabled', APP_STARTUP_SENDER_WORKER_MODE: 'disabled', SCRAPY_PROCESS_MODE: 'disabled', LASERREACH_SCRAPY_PROCESS_MODE: 'disabled', AUTO_RESUME_LEGACY_CAMPAIGNS: 'false', TEST_MODE_REDIS_HOST: '127.0.0.1', TEST_MODE_REDIS_PORT: String(redisPort), REDIS_HOST: 'localhost', REDIS_PASSWORD: '', DDB_LOCAL_ENDPOINT: ddbEndpoint, AWS_ENDPOINT_URL_DYNAMODB: ddbEndpoint, AWS_DEFAULT_REGION: 'us-east-2', DYNAMODB_REGION: 'us-east-2', AWS_ACCESS_KEY_ID: 'e2e', AWS_SECRET_ACCESS_KEY: 'e2e', AWS_EC2_METADATA_DISABLED: 'true', UNIPILE_API_KEY: 'test', JWT_SECRET_KEY: jwtSecret, PORT: String(backendPort), INTELLI_CALLING_TABLE: 'abm_intelli_calling', INTELLI_LOCAL_NUMBER_IDS: 'caller-e2e', E2E_TENANT: tenant, E2E_USER: actor, E2E_FOREIGN: foreign };
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laserreach-dialer-audio-')); const statePath = path.join(stateDir, 'provider.json'); const answerPath = path.join(stateDir, 'answer.json'); const offerPath = path.join(stateDir, 'offer.json');
  fs.writeFileSync(statePath, JSON.stringify({ starts: 0, ends: 0, closes: 0, calls: {} }), { mode: 0o600 });
  setupDdb(baseEnv); const values = seedCalls(baseEnv, tenant, actor);
  const redis = spawn('redis-server', ['--port', String(redisPort), '--save', '', '--appendonly', 'no'], { cwd: appRoot, stdio: ['ignore', 'ignore', 'ignore'] });
  const bootstrapModule = `laserreach_intelli_audio_${crypto.randomUUID().replaceAll('-', '')}`; const bootstrapPath = path.join(backendRoot, `${bootstrapModule}.py`); fs.writeFileSync(bootstrapPath, backendBootstrapScript(), { mode: 0o600 });
  const backend = spawn(pythonBin, ['-m', 'gunicorn', '-k', 'customworker.CustomGeventWebSocketWorker', '-w', '1', '--bind', `127.0.0.1:${backendPort}`, '--access-logfile', '-', '--error-logfile', '-', `${bootstrapModule}:app`], { cwd: backendRoot, env: { ...baseEnv, E2E_PROVIDER_STATE: statePath, E2E_ANSWER_PATH: answerPath, E2E_OFFER_PATH: offerPath }, stdio: ['ignore', 'pipe', 'pipe'] });
  let backendOutput = ''; backend.stdout.on('data', (chunk) => { backendOutput += chunk.toString(); }); backend.stderr.on('data', (chunk) => { backendOutput += chunk.toString(); });
  let proxy; let electron; let renderer; let profileDir;
  try {
    await waitForTcp(redisPort); await waitForHttp(`http://127.0.0.1:${backendPort}/`);
    proxy = startAudioProxy(backendPort, answerPath); await proxy.listen(); const proxyPort = proxy.server.address().port;
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laserreach-dialer-audio-profile-')); fs.writeFileSync(path.join(profileDir, 'settings.json'), JSON.stringify({ hosted: { backendUrl: `http://127.0.0.1:${proxyPort}`, frontendUrl: `http://127.0.0.1:${proxyPort}`, tenantId: tenant, jwtToken: token } }), { mode: 0o600 });
    electron = spawn(binary, [appRoot, '--headless', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`], { cwd: appRoot, env: { ...process.env, INTELLI_CAPTURE_PROTECTION: 'off', INTELLI_STARTUP_SMOKE: '1' }, stdio: ['ignore', 'ignore', 'ignore'] });
    renderer = new CdpClient((await waitForPageTarget(debugPort)).webSocketDebuggerUrl); await renderer.command('Runtime.enable');
    await waitUntil(() => renderer.evaluate(`document.getElementById('signinBtn').textContent === 'Signed In'`), Boolean, 30000, 'authenticated bar');
    const audioBase64 = fs.readFileSync(wavPath).toString('base64');
    await renderer.evaluate(`(async()=>{const m=window.__audioMetrics={answerSent:false,remoteTrack:false,cleaned:false};const raw=Uint8Array.from(atob(${JSON.stringify(audioBase64)}),c=>c.charCodeAt(0));const ctx=new AudioContext();const buf=await ctx.decodeAudioData(raw.buffer);let source;function makeLocal(){source=ctx.createBufferSource();source.buffer=buf;source.loop=true;const destination=ctx.createMediaStreamDestination();source.connect(destination);source.start();return destination.stream;}navigator.mediaDevices.getUserMedia=async()=>{await ctx.resume();return makeLocal();};window.__makeMediaAnswer=async(offer,url)=>{const other=new RTCPeerConnection({iceServers:[]});const otherCtx=new AudioContext();await otherCtx.resume();const otherSource=otherCtx.createBufferSource();otherSource.buffer=buf;otherSource.loop=true;const otherDest=otherCtx.createMediaStreamDestination();otherSource.connect(otherDest);otherSource.start();other.addTrack(otherDest.stream.getAudioTracks()[0],otherDest.stream);other.ontrack=()=>{m.remoteTrack=true;};await other.setRemoteDescription(offer);await other.setLocalDescription(await other.createAnswer());await new Promise(r=>{if(other.iceGatheringState==='complete')r();else{const t=setTimeout(r,5000);other.onicecandidate=e=>{if(!e.candidate){clearTimeout(t);r();}};}});await fetch(url,{method:'POST',body:JSON.stringify({type:'answer',sdp:other.localDescription.sdp})});m.answerSent=true;m.other=other;m.otherCtx=otherCtx;m.otherSource=otherSource;return true;};window.__cleanupMedia=async()=>{try{if(m.other)m.other.close();if(m.otherSource)m.otherSource.stop();if(m.otherCtx)await m.otherCtx.close();if(source)source.stop();if(ctx.state!=='closed')await ctx.close();m.cleaned=true;}catch(e){m.cleanupError=String(e);}};})();`, true);
    await renderer.evaluate(`document.getElementById('dialerBtn').click()`); await waitUntil(() => renderer.evaluate(`document.querySelector('#dc-people button')?.textContent.includes('Dialer Buyer')`), Boolean, 30000, 'buyer search result');
    await renderer.evaluate(`document.querySelector('#dc-people button').click()`); await waitUntil(() => renderer.evaluate(`document.getElementById('dc-person-name').textContent === 'Dialer Buyer'`), Boolean, 10000, 'buyer context');
    await renderer.evaluate(`document.getElementById('dc-script').value=document.querySelector('#dc-script option:not([value=""])')?.value;document.getElementById('dc-script').dispatchEvent(new Event('change'));document.getElementById('dc-review').click()`); await waitUntil(() => renderer.evaluate(`!document.getElementById('dc-start').disabled`), Boolean, 30000, 'prepared call');
    await renderer.evaluate(`document.getElementById('dc-start').click()`); await waitUntil(() => fs.existsSync(offerPath), Boolean, 30000, 'backend received browser offer');
    const offer = JSON.parse(fs.readFileSync(offerPath, 'utf8')); await renderer.evaluate(`window.__makeMediaAnswer(${JSON.stringify(offer)},${JSON.stringify(`http://127.0.0.1:${proxyPort}/e2e-answer`)})`, true);
    await waitUntil(() => renderer.evaluate(`document.getElementById('dc-status').textContent.includes('Live coaching is listening')`), Boolean, 30000, 'active dialer');
    await waitUntil(() => renderer.evaluate(`window.__audioMetrics.answerSent && window.__audioMetrics.remoteTrack`), Boolean, 30000, 'remote peer reaches call media');
    await waitUntil(() => proxy.metrics.asrChunks >= 2, Boolean, 30000, 'mixed audio reaches ASR proxy');
    await waitUntil(() => proxy.metrics.analyses > 0, Boolean, 15000, 'automatic coaching analysis');
    await waitUntil(async () => { const panels = await renderer.evaluate('window.electronAPI.listOverlayPanels()', true); return Array.isArray(panels?.keys) && panels.keys.includes('ai_coach_live'); }, Boolean, 30000, 'coaching panel hook');
    await waitUntil(async () => {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      for (const target of targets.filter((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl)) {
        const panel = new CdpClient(target.webSocketDebuggerUrl);
        try {
          if (await panel.evaluate(`document.getElementById('panel-content')?.textContent.includes('Buyer needs a clear implementation timeline.')`)) return true;
        } finally { panel.close(); }
      }
      return false;
    }, Boolean, 10000, 'rendered coaching result');
    const metrics = await renderer.evaluate('window.__audioMetrics'); assert.ok(proxy.metrics.asrMaxAbs > 0.0001); assert.ok(proxy.metrics.asrChunks >= 2); assert.ok(metrics.answerSent && metrics.remoteTrack);
    await renderer.evaluate(`document.getElementById('dc-end').click()`); await waitUntil(() => renderer.evaluate(`document.getElementById('dc-call-state').textContent === 'Ended'`), Boolean, 20000, 'ended dialer');
    await renderer.evaluate('window.__cleanupMedia()', true); const finalMetrics = await renderer.evaluate('window.__audioMetrics'); assert.equal(finalMetrics.cleaned, true);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8')); assert.equal(state.starts, 1); assert.equal(state.ends, 1); assert.equal(state.closes, 1); const actualCalls = Object.entries(state.calls); assert.equal(actualCalls.length, 1); assert.equal(actualCalls[0][1].state, 'ended'); assert.equal(readCallState(baseEnv, tenant, actualCalls[0][0]), 'ended');
    const evidence = { calls: 1, fake_adapter: { starts: state.starts, ends: state.ends, closes: state.closes }, audio: { answer_sent: metrics.answerSent, remote_track: metrics.remoteTrack, asr_chunks: proxy.metrics.asrChunks, max_abs_sample: Number(proxy.metrics.asrMaxAbs.toFixed(5)), cleaned: finalMetrics.cleaned }, asr: { fake_stream_starts: proxy.metrics.asrStarts, fake_chunks: proxy.metrics.asrChunks, fake_stream_ends: proxy.metrics.asrEnds }, coaching: { analyses: proxy.metrics.analyses, live_panel: true }, provider_calls: 0, janus_calls: 0, sip_calls: 0 };
    const evidenceDir = '/Users/trevormartin/Projects/laserreach/output/calling-validation-20260920/dialer-audio'; fs.mkdirSync(evidenceDir, { recursive: true }); fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 }); fs.writeFileSync(path.join(evidenceDir, 'stdout.log'), `audio_e2e ${JSON.stringify(evidence)}\n`, { mode: 0o600 });
    process.stdout.write(`[electron-dialer-audio] ${JSON.stringify(evidence)}\n`);
  } catch (error) { throw new Error(`${error.message}; backend_tail=${backendOutput.slice(-3000)}`); }
  finally {
    if (renderer) renderer.close(); if (electron && electron.exitCode === null && !electron.signalCode) electron.kill('SIGTERM'); if (electron) await waitForChildExit(electron); if (proxy) await proxy.close(); if (backend && backend.exitCode === null && !backend.signalCode) backend.kill('SIGTERM'); if (backend) await waitForChildExit(backend); if (redis && redis.exitCode === null && !redis.signalCode) redis.kill('SIGTERM'); if (redis) await waitForChildExit(redis); try { cleanupCalls(baseEnv, tenant, values); } catch (error) { process.stderr.write(`[electron-dialer-audio] cleanup_error=${error.message}\n`); } if (profileDir) fs.rmSync(profileDir, { recursive: true, force: true }); fs.rmSync(bootstrapPath, { force: true }); fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
