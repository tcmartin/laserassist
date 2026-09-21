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
const runEnabled = process.env.RUN_INTELLI_DIALER_E2E === '1';
const CALL_OFFER = { type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' };

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
context = {"tenant_id": tenant, "context_snapshot_id": "snapshot-e2e", "person": {"full_name": "Dialer Buyer"}, "phone_candidates": [{"number_id": "destination-e2e", "number": "+12025550101", "eligible": True}]}
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
for call_id in os.environ["E2E_CALL_IDS"].split(","):
    table.delete_item(Key={"tenant_id": tenant, "record_id": "call#" + call_id})
table.delete_item(Key={"tenant_id": tenant, "record_id": "script#" + os.environ["E2E_SCRIPT_ID"]})
table.delete_item(Key={"tenant_id": tenant, "record_id": "number#caller-e2e"})
users = db.Table("users3")
users.delete_item(Key={"username": os.environ["E2E_USER"]})
users.delete_item(Key={"username": os.environ["E2E_FOREIGN"]})
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
from routes import intelli_session_routes, intelli_media_socket

def context_resolver(tenant_id, **_kwargs):
    return {"tenant_id": tenant_id, "context_snapshot_id": "snapshot-e2e", "person": {"full_name": "Dialer Buyer"}, "phone_candidates": [{"number_id": "destination-e2e", "number": "+12025550101", "eligible": True}]}
intelli_session_routes.resolve_call_context = context_resolver
state_path = os.environ["E2E_PROVIDER_STATE"]
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
        mutate(self.call_id, "starts")
        return {"provider_call_id": "fake-provider-" + self.call_id[-12:], "state": "connected"}
    def trickle(self, candidate):
        assert candidate is None or isinstance(candidate, dict)
        return {"accepted": True}
    def poll(self, _timeout):
        events = []
        if not self.polled:
            events = [{"type": "accepted", "state": "connected"}]
            self.polled = True
        return {"events": events, "state": "connected"}
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

test('real Electron signaling drives the registered backend media route', {
  skip: runEnabled ? false : 'set RUN_INTELLI_DIALER_E2E=1 to run the local Electron/backend diagnostic',
  timeout: 120000,
}, async () => {
  assert.ok(fs.existsSync(pythonBin), 'pinned Python runtime is installed');
  const binary = findElectronBinary();
  assert.ok(binary, 'Electron binary is installed');
  const backendPort = await freePort();
  const redisPort = await freePort();
  const debugPort = await freePort();
  const ddbEndpoint = process.env.DDB_LOCAL_ENDPOINT || 'http://127.0.0.1:8000';
  const tenant = `dialer-e2e-${crypto.randomUUID()}`;
  const actor = `dialer-user-${crypto.randomUUID()}`;
  const foreign = `dialer-foreign-${crypto.randomUUID()}`;
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  const token = signJwt(jwtSecret, actor);
  const foreignToken = signJwt(jwtSecret, foreign);
  const baseEnv = {
    ...process.env, TEST_MODE: '1', RBAC_ENFORCE: 'false', APP_HOST: '127.0.0.1',
    APP_STARTUP_WORKERS_MODE: 'disabled', APP_STARTUP_SENDER_WORKER_MODE: 'disabled',
    SCRAPY_PROCESS_MODE: 'disabled', LASERREACH_SCRAPY_PROCESS_MODE: 'disabled',
    AUTO_RESUME_LEGACY_CAMPAIGNS: 'false', TEST_MODE_REDIS_HOST: '127.0.0.1',
    TEST_MODE_REDIS_PORT: String(redisPort), REDIS_HOST: 'localhost', REDIS_PASSWORD: '',
    DDB_LOCAL_ENDPOINT: ddbEndpoint, AWS_ENDPOINT_URL_DYNAMODB: ddbEndpoint,
    AWS_DEFAULT_REGION: 'us-east-2', DYNAMODB_REGION: 'us-east-2', AWS_ACCESS_KEY_ID: 'e2e',
    AWS_SECRET_ACCESS_KEY: 'e2e', AWS_EC2_METADATA_DISABLED: 'true', UNIPILE_API_KEY: 'test',
    JWT_SECRET_KEY: jwtSecret, PORT: String(backendPort), INTELLI_CALLING_TABLE: 'abm_intelli_calling',
    INTELLI_LOCAL_NUMBER_IDS: 'caller-e2e', E2E_TENANT: tenant, E2E_USER: actor, E2E_FOREIGN: foreign,
  };
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laserreach-dialer-state-'));
  const statePath = path.join(stateDir, 'provider.json');
  fs.writeFileSync(statePath, JSON.stringify({ starts: 0, ends: 0, closes: 0, calls: {} }), { mode: 0o600 });
  setupDdb(baseEnv);
  const values = seedCalls(baseEnv, tenant, actor);
  const redis = spawn('redis-server', ['--port', String(redisPort), '--save', '', '--appendonly', 'no'], { cwd: appRoot, stdio: ['ignore', 'ignore', 'ignore'] });
  const bootstrapModule = `laserreach_intelli_dialer_${crypto.randomUUID().replaceAll('-', '')}`;
  const bootstrapPath = path.join(backendRoot, `${bootstrapModule}.py`);
  fs.writeFileSync(bootstrapPath, backendBootstrapScript(), { mode: 0o600 });
  const backend = spawn(pythonBin, ['-m', 'gunicorn', '-k', 'customworker.CustomGeventWebSocketWorker', '-w', '1', '--bind', `127.0.0.1:${backendPort}`, '--access-logfile', '-', '--error-logfile', '-', `${bootstrapModule}:app`], {
    cwd: backendRoot, env: { ...baseEnv, E2E_PROVIDER_STATE: statePath }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let backendOutput = '';
  backend.stdout.on('data', (chunk) => { backendOutput += chunk.toString(); });
  backend.stderr.on('data', (chunk) => { backendOutput += chunk.toString(); });
  let electron;
  let renderer;
  let profileDir;
  try {
    await waitForTcp(redisPort);
    await waitForHttp(`http://127.0.0.1:${backendPort}/`);
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laserreach-dialer-e2e-'));
    fs.writeFileSync(path.join(profileDir, 'settings.json'), JSON.stringify({ hosted: {
      backendUrl: `http://127.0.0.1:${backendPort}`, frontendUrl: `http://127.0.0.1:${backendPort}`,
      tenantId: tenant, jwtToken: token,
    } }, null, 2), { mode: 0o600 });
    electron = spawn(binary, [appRoot, '--headless', '--disable-gpu', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`], {
      cwd: appRoot, env: { ...process.env, INTELLI_CAPTURE_PROTECTION: 'off', INTELLI_STARTUP_SMOKE: '1' }, stdio: ['ignore', 'ignore', 'ignore'],
    });
    renderer = new CdpClient((await waitForPageTarget(debugPort)).webSocketDebuggerUrl);
    const activeId = values.call_ids[0];
    const disconnectId = values.call_ids[1];
    const started = await renderer.evaluate(`window.electronAPI.callingMediaStart(${JSON.stringify({ callId: activeId, offer: CALL_OFFER })})`, true);
    assert.equal(started.success, true, JSON.stringify(started));
    assert.equal(started.state, 'connected', JSON.stringify(started));
    const trickled = await renderer.evaluate(`window.electronAPI.callingMediaTrickle(${JSON.stringify({ callId: activeId, candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 } })})`, true);
    assert.equal(trickled.success, true, JSON.stringify(trickled));
    const ended = await renderer.evaluate(`window.electronAPI.callingMediaEnd(${JSON.stringify(activeId)})`, true);
    assert.equal(ended.success, true, JSON.stringify(ended));
    await waitUntil(() => readCallState(baseEnv, tenant, activeId), (state) => state === 'ended', 10000, 'active call persisted ended state');

    const secondStarted = await renderer.evaluate(`window.electronAPI.callingMediaStart(${JSON.stringify({ callId: disconnectId, offer: CALL_OFFER })})`, true);
    assert.equal(secondStarted.success, true, JSON.stringify(secondStarted));
    const closed = await renderer.evaluate(`window.electronAPI.callingMediaClose(${JSON.stringify(disconnectId)})`, true);
    assert.equal(closed.success, true, JSON.stringify(closed));
    await waitUntil(() => readCallState(baseEnv, tenant, disconnectId), (state) => state === 'ended', 10000, 'disconnect cleanup persisted ended state');

    const { CallSignaling } = require('../src/call-signaling');
    const foreignClient = new CallSignaling({
      callId: activeId,
      getConfig: () => ({ backendUrl: `http://127.0.0.1:${backendPort}`, tenantId: tenant, jwtToken: foreignToken }),
      timeoutMs: 5000,
    });
    await assert.rejects(() => foreignClient.start(CALL_OFFER), /call_signaling_(call_not_found|closed)/);
    foreignClient.close();
    const providerState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(providerState.starts, 2, 'foreign actor must not construct/start fake provider');
    assert.equal(providerState.ends, 2, 'explicit end and disconnect both hang up');
    process.stdout.write(`[electron-dialer-e2e] calls=2 starts=${providerState.starts} ends=${providerState.ends} closes=${providerState.closes} provider_calls=0 janus_calls=0 sip_calls=0\n`);
  } catch (error) {
    let fixtureState = '';
    try { fixtureState = `; fixture_state=${fs.readFileSync(statePath, 'utf8')}`; } catch (_) {}
    throw new Error(`${error.message}${fixtureState}; backend_tail=${backendOutput.slice(-5000)}`);
  } finally {
    if (renderer) renderer.close();
    if (electron && electron.exitCode === null && !electron.signalCode) electron.kill('SIGTERM');
    if (electron) await waitForChildExit(electron);
    if (backend && backend.exitCode === null && !backend.signalCode) backend.kill('SIGTERM');
    if (backend) await waitForChildExit(backend);
    if (redis && redis.exitCode === null && !redis.signalCode) redis.kill('SIGTERM');
    if (redis) await waitForChildExit(redis);
    try { cleanupCalls(baseEnv, tenant, values); } catch (error) { process.stderr.write(`[electron-dialer-e2e] cleanup_error=${error.message}\n`); }
    if (profileDir) fs.rmSync(profileDir, { recursive: true, force: true });
    fs.rmSync(bootstrapPath, { force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
