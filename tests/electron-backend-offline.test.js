/*
 * Real backend offline Intelli diagnostic.
 *
 * This starts the repository's actual Flask-Sock app under the custom gevent
 * Gunicorn worker. Only abm.intelli_service.run_gpt5mini_analysis is replaced
 * in the bootstrap process with a deterministic result; context construction,
 * auth, Redis sessions, WebSocket dispatch, Electron IPC, and cleanup remain
 * real. No ASR or provider calls are made. Run with RUN_INTELLI_BACKEND_OFFLINE=1.
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
const runEnabled = process.env.RUN_INTELLI_BACKEND_OFFLINE === '1';

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
  throw new Error(`Timed out waiting for TCP port ${port}`);
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
  const payload = Buffer.from(JSON.stringify({ sub: subject, type: 'access', fresh: false, iat: now, nbf: now, exp: now + 3600, jti: crypto.randomUUID(), csrf: crypto.randomBytes(16).toString('hex'), '2fa_passed': true })).toString('base64url');
  const body = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { raw: text }; }
  return { status: response.status, body };
}

function seedFixtures(env, values, cleanup = false) {
  const script = String.raw`
import os
import boto3
import hashlib
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

ddb = boto3.resource("dynamodb", endpoint_url=os.environ.get("DDB_LOCAL_ENDPOINT"), region_name="us-east-2", aws_access_key_id="e2e", aws_secret_access_key="e2e")
calling_table = os.environ["E2E_CALLING_TABLE"]
try:
    ddb.meta.client.describe_table(TableName=calling_table)
except ClientError as exc:
    if exc.response.get("Error", {}).get("Code") != "ResourceNotFoundException":
        raise
    table = ddb.create_table(TableName=calling_table, KeySchema=[{"AttributeName": "tenant_id", "KeyType": "HASH"}, {"AttributeName": "record_id", "KeyType": "RANGE"}], AttributeDefinitions=[{"AttributeName": "tenant_id", "AttributeType": "S"}, {"AttributeName": "record_id", "AttributeType": "S"}], BillingMode="PAY_PER_REQUEST")
    table.wait_until_exists()
tenant = os.environ["E2E_TENANT"]
user = os.environ["E2E_USER"]
foreign_user = os.environ["E2E_FOREIGN_USER"]
pipeline = os.environ["E2E_PIPELINE"]
person = os.environ["E2E_PERSON"]
company = os.environ["E2E_COMPANY"]
script_id = os.environ["E2E_SCRIPT"]
caller_number_id = os.environ["E2E_CALLER_NUMBER"]
destination_number_id = os.environ["E2E_DESTINATION"]
destination_number = "+12025550101"
items = [
    ("users3", {"username": user, "email": user + "@example.invalid"}),
    ("users3", {"username": foreign_user, "email": foreign_user + "@example.invalid"}),
    ("organizations3", {"org_id": tenant, "name": "Offline Intelli Workspace", "owner": user, "laserreach_tier": "laserreach_team", "laserreach_status": "active"}),
    ("abm_iam", {"PK": "ORG#" + tenant, "SK": "MEMB#" + user, "Type": "Membership", "username": user, "role_ids": ["owner"], "effective_permissions": ["*"], "status": "active", "GSI1PK": "USER#" + user, "GSI1SK": "ORG#" + tenant + "#MEMB"}),
    ("abm_iam", {"PK": "ORG#" + tenant, "SK": "MEMB#" + foreign_user, "Type": "Membership", "username": foreign_user, "role_ids": ["owner"], "effective_permissions": ["*"], "status": "active", "GSI1PK": "USER#" + foreign_user, "GSI1SK": "ORG#" + tenant + "#MEMB"}),
    ("abm_people", {"tenant_id": tenant, "person_id": person, "full_name": "Jordan Buyer", "name": "Jordan Buyer", "title": "VP Revenue", "email": "jordan.buyer@example.invalid", "company_id": company, "phone_number": destination_number}),
    ("abm_companies", {"tenant_id": tenant, "company_id": company, "name": "Acme Vector", "industry": "Revenue technology", "website": "https://acme-vector.invalid"}),
    ("abm_pipelines", {"tenant_id": tenant, "pipeline_id": pipeline, "person_id": person, "company_id": company, "status": "active", "current_step": 1, "steps": [{"type": "call", "status": "scheduled", "data": {"topic": "revenue intelligence"}}]}),
    (calling_table, {"tenant_id": tenant, "record_id": "script#" + script_id, "entity_type": "call_script", "revision": 1, "body": __import__("json").dumps([{"tenant_id": tenant, "template_id": script_id, "revision": 1, "title": "Offline discovery", "opening": "Hello {{person.full_name}}.", "questions": ["What changed this quarter?"], "objection_guidance": [], "next_step": "Agree on a technical review.", "variables": ["person.full_name"], "created_by": user, "source": "user", "created_at": "2026-09-20T00:00:00+00:00", "status": "active"}])}),
    (calling_table, {"tenant_id": tenant, "record_id": "number#" + caller_number_id, "number_id": caller_number_id, "number": "+12025550102", "provider": "loopback", "account_ref": "offline-synthetic", "local_only": True, "status": "active"}),
]
for table_name, item in items:
    table = ddb.Table(table_name)
    schema = table.key_schema
    key = {part["AttributeName"]: item[part["AttributeName"]] for part in schema}
    if ${cleanup ? 'True' : 'False'}:
        table.delete_item(Key=key)
    else:
        table.put_item(Item=item)
if ${cleanup ? 'True' : 'False'}:
    call_table = ddb.Table(calling_table)
    call_rows = call_table.query(KeyConditionExpression=Key("tenant_id").eq(tenant) & Key("record_id").begins_with("call#"), ConsistentRead=True).get("Items", [])
    for call_row in call_rows:
        call_table.delete_item(Key={"tenant_id": tenant, "record_id": call_row["record_id"]})
    for table_name, item in items:
        table = ddb.Table(table_name)
        schema = table.key_schema
        key = {part["AttributeName"]: item[part["AttributeName"]] for part in schema}
        if table.get_item(Key=key, ConsistentRead=True).get("Item"):
            raise RuntimeError(f"fixture cleanup verification failed: {table_name}")
    call_rows = ddb.Table(calling_table).query(
        KeyConditionExpression=Key("tenant_id").eq(tenant) & Key("record_id").begins_with("call#"),
        ConsistentRead=True,
    ).get("Items", [])
    if call_rows:
        raise RuntimeError("fixture cleanup verification failed: prepared calls remain")
    ddb.Table(calling_table).delete()
    ddb.Table(calling_table).wait_until_not_exists()
`;
  const result = spawnSync(pythonBin, ['-c', script], {
    cwd: backendRoot,
    env: { ...env, ...values },
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`fixture ${cleanup ? 'cleanup' : 'seed'} failed (${result.status}): ${result.stderr}`);
}

function mutatePreparedSources(env, values) {
  const script = String.raw`
import json
import os
import boto3

ddb = boto3.resource("dynamodb", endpoint_url=os.environ["DDB_LOCAL_ENDPOINT"], region_name="us-east-2", aws_access_key_id="e2e", aws_secret_access_key="e2e")
tenant = os.environ["E2E_TENANT"]
calling_table = os.environ["E2E_CALLING_TABLE"]
person = os.environ["E2E_PERSON"]
script_id = os.environ["E2E_SCRIPT"]
people = ddb.Table("abm_people")
people.update_item(Key={"tenant_id": tenant, "person_id": person}, UpdateExpression="SET full_name = :name, #name = :name", ExpressionAttributeNames={"#name": "name"}, ExpressionAttributeValues={":name": "Mutated Buyer"})
table = ddb.Table(calling_table)
row = table.get_item(Key={"tenant_id": tenant, "record_id": "script#" + script_id}, ConsistentRead=True)["Item"]
history = json.loads(row["body"])
history[0]["opening"] = "Tampered opening {{person.full_name}}."
table.put_item(Item={**row, "body": json.dumps(history)})
`;
  const result = spawnSync(pythonBin, ['-c', script], {
    cwd: backendRoot,
    env: { ...env, ...values },
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`fixture mutation failed (${result.status}): ${result.stderr}`);
}

function backendBootstrapScript() {
  return String.raw`
import sys
import abm.intelli_service as intelli_service

def fake_analysis(transcript, *, tenant_id, current_user="", scope_id="", analysis_type="full", context_bundle=None, custom_prompt=None, model="gpt-5-mini", max_completion_tokens=4000, **kwargs):
    context = context_bundle or {}
    return {
        "analysis_type": analysis_type,
        "model": model,
        "max_completion_tokens": max_completion_tokens,
        "parsed": {"summary": "offline backend coaching", "next_best_actions": ["Confirm the buyer's implementation timeline."], "max_completion_tokens": max_completion_tokens, "prepared_call": context.get("prepared_call"), "rendered_script": context.get("rendered_script"), "prepared_person": (context.get("prepared_call_context") or {}).get("person", {}).get("full_name")},
        "text": "offline backend coaching",
        "usage": {"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5, "artifact_cache_hit": False},
        "context": context,
    }

intelli_service.run_gpt5mini_analysis = fake_analysis
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

test('real Electron reaches the actual gevent backend with fake analysis', {
  skip: runEnabled ? false : 'set RUN_INTELLI_BACKEND_OFFLINE=1 to run the backend offline diagnostic',
  timeout: 120000,
}, async () => {
  assert.ok(fs.existsSync(pythonBin), 'pinned Python runtime is installed');
  const binary = findElectronBinary();
  assert.ok(binary, 'Electron binary is installed');
  const backendPort = await freePort();
  const redisPort = await freePort();
  const debugPort = await freePort();
  const fixture = {
    tenant: `offline-intelli-${crypto.randomUUID()}`,
    user: `offline-user-${crypto.randomUUID()}`,
    pipeline: `offline-pipeline-${crypto.randomUUID()}`,
    person: `offline-person-${crypto.randomUUID()}`,
    company: `offline-company-${crypto.randomUUID()}`,
    script: `script_${crypto.randomBytes(16).toString('hex')}`,
    callerNumber: `offline-caller-${crypto.randomUUID()}`,
    destination: `phone_${crypto.createHash('sha256').update('2025550101').digest('hex').slice(0, 24)}`,
    callingTable: `abm_intelli_calling_${crypto.randomUUID().replaceAll('-', '')}`,
  };
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  const token = signJwt(jwtSecret, fixture.user);
  const baseEnv = {
    ...process.env,
    TEST_MODE: '1', RBAC_ENFORCE: 'false', APP_HOST: '127.0.0.1',
    APP_STARTUP_WORKERS_MODE: 'disabled', APP_STARTUP_SENDER_WORKER_MODE: 'disabled',
    SCRAPY_PROCESS_MODE: 'disabled', LASERREACH_SCRAPY_PROCESS_MODE: 'disabled',
    AUTO_RESUME_LEGACY_CAMPAIGNS: 'false', TEST_MODE_REDIS_HOST: '127.0.0.1',
    TEST_MODE_REDIS_PORT: String(redisPort), REDIS_HOST: 'localhost', REDIS_PASSWORD: '',
    DDB_LOCAL_ENDPOINT: 'http://127.0.0.1:8000', AWS_ENDPOINT_URL_DYNAMODB: 'http://127.0.0.1:8000',
    AWS_DEFAULT_REGION: 'us-east-2', DYNAMODB_REGION: 'us-east-2', AWS_ACCESS_KEY_ID: 'e2e',
    AWS_SECRET_ACCESS_KEY: 'e2e', AWS_EC2_METADATA_DISABLED: 'true', UNIPILE_API_KEY: 'test',
    JWT_SECRET_KEY: jwtSecret, AI_GATEWAY_MONTHLY_BUDGET_USD: '2', PORT: String(backendPort),
    INTELLI_CALLING_TABLE: fixture.callingTable, INTELLI_LOCAL_NUMBER_IDS: `offline-caller-${fixture.callerNumber.split('-').slice(2).join('-')}`,
  };
  const seedEnv = { ...baseEnv, E2E_TENANT: fixture.tenant, E2E_USER: fixture.user, E2E_FOREIGN_USER: `offline-foreign-${crypto.randomUUID()}`, E2E_PIPELINE: fixture.pipeline, E2E_PERSON: fixture.person, E2E_COMPANY: fixture.company, E2E_SCRIPT: fixture.script, E2E_CALLER_NUMBER: fixture.callerNumber, E2E_DESTINATION: fixture.destination, E2E_CALLING_TABLE: fixture.callingTable };
  const redis = spawn('redis-server', ['--port', String(redisPort), '--save', '', '--appendonly', 'no'], { cwd: appRoot, stdio: ['ignore', 'ignore', 'ignore'] });
  const bootstrapModule = `laserreach_intelli_backend_offline_${crypto.randomUUID().replaceAll('-', '')}`;
  const bootstrapPath = path.join(backendRoot, `${bootstrapModule}.py`);
  fs.writeFileSync(bootstrapPath, backendBootstrapScript(), { mode: 0o600 });
  const backend = spawn(pythonBin, ['-m', 'gunicorn', '-k', 'customworker.CustomGeventWebSocketWorker', '-w', '1', '--bind', `127.0.0.1:${backendPort}`, '--access-logfile', '-', '--error-logfile', '-', `${bootstrapModule}:app`], { cwd: backendRoot, env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let backendOutput = '';
  backend.stdout.on('data', (chunk) => { backendOutput += chunk.toString(); });
  backend.stderr.on('data', (chunk) => { backendOutput += chunk.toString(); });
  let electron;
  let renderer;
  let profileDir;
  const timings = { started: Date.now() };
  try {
    await waitForTcp(redisPort);
    try {
      await waitForHttp(`http://127.0.0.1:${backendPort}/`);
    } catch (error) {
      throw new Error(`${error.message}; backend_state=${backend.exitCode === null ? 'running' : `exit:${backend.exitCode}`}; backend_tail=${backendOutput.slice(-4000)}`);
    }
    timings.backendReady = Date.now();
    seedFixtures(seedEnv, seedEnv, false);
    const authHeaders = {
      Authorization: `Bearer ${token}`,
      'X-Org-ID': fixture.tenant,
      'Content-Type': 'application/json',
    };
    const contextResponse = await requestJson(
      `http://127.0.0.1:${backendPort}/api/abm/intelli/call-context?person_id=${encodeURIComponent(fixture.person)}&pipeline_id=${encodeURIComponent(fixture.pipeline)}`,
      { headers: authHeaders },
    );
    assert.equal(contextResponse.status, 200, JSON.stringify(contextResponse.body));
    const contextSnapshotId = contextResponse.body?.context?.context_snapshot_id;
    assert.match(String(contextSnapshotId || ''), /^ctx_[0-9a-f]+$/);
    const prepareResponse = await requestJson(`http://127.0.0.1:${backendPort}/api/abm/intelli/calls`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        person_id: fixture.person,
        pipeline_id: fixture.pipeline,
        context_snapshot_id: contextSnapshotId,
        number_id: fixture.destination,
        caller_number_id: fixture.callerNumber,
        script_template_id: fixture.script,
        script_revision: 1,
        mode: 'local_test',
        confirmed: true,
        idempotency_key: `offline-${crypto.randomUUID()}`,
      }),
    });
    assert.equal(prepareResponse.status, 201, JSON.stringify(prepareResponse.body));
    const preparedCall = prepareResponse.body?.call;
    const callId = preparedCall?.call_id;
    assert.match(String(callId || ''), /^call_[0-9a-f]{64}$/);
    assert.equal(preparedCall.rendered_script.opening, 'Hello Jordan Buyer.');
    mutatePreparedSources(seedEnv, seedEnv);
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laserreach-intelli-backend-offline-'));
    fs.writeFileSync(path.join(profileDir, 'settings.json'), JSON.stringify({ hosted: {
      backendUrl: `http://127.0.0.1:${backendPort}`, frontendUrl: `http://127.0.0.1:${backendPort}`,
      tenantId: fixture.tenant, jwtToken: token, analysisModel: 'gpt-5-mini', defaultPipelineId: `unrelated-${crypto.randomUUID()}`,
    } }, null, 2), { mode: 0o600 });
    electron = spawn(binary, [appRoot, '--headless', '--disable-gpu', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`], { cwd: appRoot, env: { ...process.env, INTELLI_CAPTURE_PROTECTION: 'off', INTELLI_STARTUP_SMOKE: '1' }, stdio: ['ignore', 'ignore', 'ignore'] });
    renderer = new CdpClient((await waitForPageTarget(debugPort)).webSocketDebuggerUrl);
    await renderer.evaluate(`(() => { window.__backendOffline = { responses: [], statuses: [] }; window.electronAPI.onAnalysisResponse((event) => window.__backendOffline.responses.push(event.data || event)); window.electronAPI.onStatus((msg) => window.__backendOffline.statuses.push({ ...msg, observed_at: Date.now() })); return true; })()`);
    const sessionId = `offline-session-${crypto.randomUUID()}`;
    await renderer.evaluate(`window.electronAPI.sessionStart(${JSON.stringify(sessionId)}, ${JSON.stringify({ pipeline_id: fixture.pipeline })})`);
    await renderer.evaluate(`window.electronAPI.sessionAppendTranscript(${JSON.stringify(sessionId)}, ${JSON.stringify({ text: 'The buyer asked about implementation timing.', ts: new Date().toISOString() })})`);
    timings.sessionReady = Date.now();
    const analysisId = 'backend-offline-analysis';
    await renderer.evaluate(`window.electronAPI.sendAnalysisRequest(${JSON.stringify({ id: analysisId, transcript: 'The buyer asked about implementation timing.', analysisType: 'summary', model: 'gpt-5-mini', callId })})`);
    let observed;
    try {
      observed = await waitUntil(() => renderer.evaluate('window.__backendOffline'), (value) => (value.responses || []).some((item) => item.id === analysisId), 55000, 'actual backend analysis response');
    } catch (error) {
      const state = await renderer.evaluate('window.__backendOffline').catch(() => ({}));
      throw new Error(`${error.message}; ipc_responses=${JSON.stringify(state.responses || [])}; ipc_statuses=${JSON.stringify(state.statuses || [])}; backend_tail=${backendOutput.slice(-5000)}`);
    }
    timings.analysisResponse = Date.now();
    const response = observed.responses.find((item) => item.id === analysisId);
    assert.equal(response.error, undefined, `backend analysis error: ${response.error || ''}; backend=${backendOutput.slice(-1500)}`);
    assert.equal(response.raw?.context?.pipeline_id, fixture.pipeline);
    assert.equal(response.raw?.context?.person?.full_name, 'Jordan Buyer');
    assert.equal(response.raw?.context?.company?.name, 'Acme Vector');
    assert.equal(response.raw?.context?.prepared_call?.call_id, callId);
    assert.equal(response.raw?.context?.prepared_call?.script_revision, 1);
    assert.equal(response.raw?.context?.prepared_call_context?.person?.full_name, 'Jordan Buyer');
    assert.equal(response.raw?.parsed?.prepared_person, 'Jordan Buyer');
    assert.equal(response.raw?.parsed?.rendered_script?.opening, 'Hello Jordan Buyer.');
    assert.equal(response.raw?.parsed?.summary, 'offline backend coaching');
    assert.equal(response.raw?.parsed?.max_completion_tokens, 4000);
    assert.ok(observed.statuses.some((status) => status.status === 'running'));
    assert.ok(observed.statuses.some((status) => /^analysis_/.test(String(status.requestId || ''))));
    await renderer.evaluate(`window.electronAPI.sessionAppendAnalysis(${JSON.stringify(sessionId)}, ${JSON.stringify({ ts: new Date().toISOString(), results: response.raw.parsed })})`);
    await renderer.evaluate(`window.electronAPI.sessionEnd(${JSON.stringify(sessionId)}, ${JSON.stringify({ ended_at: new Date().toISOString() })})`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const stored = await renderer.evaluate(`window.electronAPI.getSession(${JSON.stringify(sessionId)})`, true);
    timings.sessionRead = Date.now();
    assert.equal(stored?.success, true);
    assert.ok(stored.session?.ended_at);
    assert.ok((stored.session?.events || []).some((event) => event.type === 'transcript'));
    assert.ok((stored.session?.events || []).some((event) => event.type === 'analysis'));

    const mismatchId = 'backend-offline-mismatch';
    await renderer.evaluate(`window.electronAPI.sendAnalysisRequest(${JSON.stringify({ id: mismatchId, transcript: 'The buyer asked about implementation timing.', analysisType: 'summary', model: 'gpt-5-mini', callId, pipelineId: 'wrong-pipeline' })})`);
    const mismatchState = await waitUntil(() => renderer.evaluate('window.__backendOffline'), (value) => (value.responses || []).some((item) => item.id === mismatchId), 10000, 'mismatched prepared-call response');
    const mismatchResponse = mismatchState.responses.find((item) => item.id === mismatchId);
    assert.equal(mismatchResponse.error, 'call_pipeline_mismatch');
    assert.equal(mismatchResponse.raw, undefined, 'mismatched pipeline must fail before fake completion');

    const foreignToken = signJwt(jwtSecret, seedEnv.E2E_FOREIGN_USER);
    const foreignProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'laserreach-intelli-backend-offline-foreign-'));
    const foreignDebugPort = await freePort();
    fs.writeFileSync(path.join(foreignProfile, 'settings.json'), JSON.stringify({ hosted: {
      backendUrl: `http://127.0.0.1:${backendPort}`, frontendUrl: `http://127.0.0.1:${backendPort}`,
      tenantId: fixture.tenant, jwtToken: foreignToken, analysisModel: 'gpt-5-mini', defaultPipelineId: '',
    } }, null, 2), { mode: 0o600 });
    const foreignElectron = spawn(binary, [appRoot, '--headless', '--disable-gpu', `--remote-debugging-port=${foreignDebugPort}`, `--user-data-dir=${foreignProfile}`], { cwd: appRoot, env: { ...process.env, INTELLI_CAPTURE_PROTECTION: 'off', INTELLI_STARTUP_SMOKE: '1' }, stdio: ['ignore', 'ignore', 'ignore'] });
    let foreignRenderer;
    try {
      foreignRenderer = new CdpClient((await waitForPageTarget(foreignDebugPort)).webSocketDebuggerUrl);
      await waitUntil(() => foreignRenderer.evaluate('typeof window.electronAPI'), (value) => value === 'object', 10000, 'foreign Electron preload');
      await foreignRenderer.evaluate(`(() => { window.__foreignOffline = { responses: [] }; window.electronAPI.onAnalysisResponse((event) => window.__foreignOffline.responses.push(event.data || event)); return true; })()`);
      const foreignId = 'backend-offline-foreign';
      await foreignRenderer.evaluate(`window.electronAPI.sendAnalysisRequest(${JSON.stringify({ id: foreignId, transcript: 'The buyer asked about implementation timing.', analysisType: 'summary', model: 'gpt-5-mini', callId })})`);
      let foreignState;
      try {
        foreignState = await waitUntil(() => foreignRenderer.evaluate('window.__foreignOffline'), (value) => (value?.responses || []).some((item) => item.id === foreignId), 10000, 'foreign actor prepared-call response');
      } catch (error) {
        const state = await foreignRenderer.evaluate('window.__foreignOffline').catch(() => ({}));
        throw new Error(`${error.message}; foreign_ipc=${JSON.stringify(state)}; foreign_exit=${foreignElectron.exitCode ?? 'running'}; backend_tail=${backendOutput.slice(-3000)}`);
      }
      const foreignResponse = foreignState.responses.find((item) => item.id === foreignId);
      assert.equal(foreignResponse.error, 'call_not_found');
      assert.equal(foreignResponse.raw, undefined, 'foreign actor must fail before fake completion');
    } finally {
      if (foreignRenderer) foreignRenderer.close();
      if (foreignElectron.exitCode === null && !foreignElectron.signalCode) foreignElectron.kill('SIGTERM');
      await waitForChildExit(foreignElectron);
      fs.rmSync(foreignProfile, { recursive: true, force: true });
    }
    process.stdout.write(`[backend-offline-e2e] backend_ms=${timings.backendReady - timings.started} session_ms=${timings.sessionReady - timings.backendReady} analysis_ms=${timings.analysisResponse - timings.sessionReady} readback_ms=${timings.sessionRead - timings.analysisResponse} running_status=true generated_request_id=true provider_calls=0 asr_calls=0\n`);
  } finally {
    if (renderer) renderer.close();
    if (electron && electron.exitCode === null && !electron.signalCode) electron.kill('SIGTERM');
    if (electron) await waitForChildExit(electron);
    if (backend && backend.exitCode === null && !backend.signalCode) backend.kill('SIGTERM');
    if (backend) await waitForChildExit(backend);
    if (redis && redis.exitCode === null && !redis.signalCode) redis.kill('SIGTERM');
    if (redis) await waitForChildExit(redis);
    try { seedFixtures(seedEnv, seedEnv, true); } catch (error) { process.stderr.write(`[backend-offline-e2e] cleanup_error=${error.message}\n`); }
    if (profileDir) fs.rmSync(profileDir, { recursive: true, force: true });
    fs.rmSync(bootstrapPath, { force: true });
  }
});
