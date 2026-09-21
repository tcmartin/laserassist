const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { URL, fileURLToPath, pathToFileURL } = require('node:url');

const { CallingClient } = require('../src/calling-client');

function loadCallingTrustGuard() {
  const mainPath = path.join(__dirname, '..', 'main.js');
  const source = fs.readFileSync(mainPath, 'utf8');
  const start = source.indexOf('function isTrustedCallingSender');
  const end = source.indexOf('\n}\n\nfunction callingFailure', start) + 2;
  assert.ok(start >= 0 && end > start, 'calling trust guard should remain a standalone function');
  return vm.runInNewContext(`(${source.slice(start, end)})`, {
    URL, fileURLToPath, path, __dirname: path.dirname(mainPath),
  });
}

function fakeWindow(url) {
  const mainFrame = { url };
  const webContents = { mainFrame };
  return { webContents, isDestroyed: () => false };
}

function setup() {
  const cfg = { backendUrl: 'https://api.example.test', tenantId: 'org_1', jwtToken: 'jwt_1' };
  const calls = [];
  const transport = {
    _headers(extra = {}) { return { Authorization: 'Bearer jwt_1', 'X-Org-ID': 'org_1', ...extra }; },
    async _request(path, options) {
      calls.push({ path, options });
      return { success: true, path };
    },
  };
  return { cfg, calls, client: new CallingClient({ transport, getConfig: () => cfg }), transport };
}

test('calling client uses bounded paths, tenant auth headers, and JSON bodies', async () => {
  const { client, calls } = setup();
  await client.getContext({ personId: 'person_1', pipelineId: 'pipe_1', eventId: 'event_1' });
  await client.listScripts({ limit: 20, includeArchived: true });
  await client.getScript('script_abc');
  await client.createScript({ title: 'Intro', opening: 'Hello', questions: [], objection_guidance: [], next_step: 'Book' });
  await client.updateScript('script_abc', { title: 'Updated', expected_revision: 1 });
  await client.archiveScript('script_abc', { expected_revision: 2 });
  await client.listNumbers({ cursor: 'cursor_1' });
  await client.getNumberOptions();
  await client.beginCheckout({ criteria: { country: 'US', area_code: '312' }, idempotency_key: 'purchase_1', confirmed: true });
  await client.getNumberRequest(`request_${'a'.repeat(64)}`);
  await client.reconcileNumber(`request_${'a'.repeat(64)}`);
  await client.prepareCall({
    person_id: 'person_1', pipeline_id: 'pipe_1', event_id: 'event_1', context_snapshot_id: 'snap_1',
    number_id: 'phone_1', caller_number_id: 'number_1', script_template_id: 'script_abc',
    script_revision: 1, mode: 'live', confirmed: true, idempotency_key: 'call_1',
  });
  await client.getCall(`call_${'b'.repeat(64)}`);
  await client.cancelCall(`call_${'b'.repeat(64)}`);

  assert.match(calls[0].path, /call-context\?person_id=person_1&pipeline_id=pipe_1&event_id=event_1/);
  const checkout = calls.find((call) => call.path.endsWith('/numbers/checkout'));
  assert.deepEqual(JSON.parse(checkout.options.body), {
    criteria: { country: 'US', area_code: '312' }, idempotency_key: 'purchase_1', confirmed: true,
  });
  assert.equal(checkout.options.headers.Authorization, 'Bearer jwt_1');
  assert.equal(checkout.options.headers['X-Org-ID'], 'org_1');
  assert.equal(checkout.options.headers['Content-Type'], 'application/json');
  assert.equal(calls.find((call) => call.path.endsWith('/numbers/options')).options.method, 'GET');
});

test('calling client rejects unknown fields, unconfirmed checkout, and unsafe identifiers before transport', async () => {
  const { client, calls } = setup();
  assert.throws(() => client.getContext({ personId: 'person_1', token: 'secret' }), /calling_unknown_field/);
  assert.throws(() => client.beginCheckout({ criteria: {}, idempotency_key: 'x', confirmed: false }), /calling_confirmation_required/);
  assert.throws(() => client.beginCheckout({ criteria: { account_sid: 'secret' }, idempotency_key: 'x', confirmed: true }), /calling_unknown_field/);
  assert.throws(() => client.getCall('call/escape'), /calling_invalid_call_id/);
  assert.throws(() => client.createScript({ title: 'x', opening: 'y', provider_secret: 'nope' }), /calling_unknown_field/);
  assert.equal(calls.length, 0);
});

test('calling IPC trusts only the bar index file main frame', () => {
  const guard = loadCallingTrustGuard();
  const localUrl = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
  const trustedBar = fakeWindow(localUrl);
  const trustedEvent = { sender: trustedBar.webContents, senderFrame: trustedBar.webContents.mainFrame };
  assert.equal(guard(trustedEvent, trustedBar), true);

  const foreign = fakeWindow(localUrl);
  assert.equal(guard({ sender: foreign.webContents, senderFrame: foreign.webContents.mainFrame }, trustedBar), false);

  const authWindow = fakeWindow(pathToFileURL(path.join(__dirname, '..', 'auth.html')).href);
  assert.equal(guard({ sender: authWindow.webContents, senderFrame: authWindow.webContents.mainFrame }, trustedBar), false);

  assert.equal(guard({ sender: trustedBar.webContents, senderFrame: { url: localUrl } }, trustedBar), false);

  const remoteFrame = { url: 'https://evil.example.test/index.html' };
  assert.equal(guard({ sender: trustedBar.webContents, senderFrame: remoteFrame }, trustedBar), false);
  const unexpectedLocalFrame = { url: `${localUrl}?unexpected=1` };
  assert.equal(guard({ sender: trustedBar.webContents, senderFrame: unexpectedLocalFrame }, trustedBar), false);
});

test('calling mutations reject oversized serialized bodies before transport', async () => {
  const { client, calls } = setup();
  assert.throws(
    () => client.createScript({ title: 'Intro', opening: 'Hello', questions: ['x'.repeat(70 * 1024)] }),
    /calling_payload_too_large/,
  );
  assert.equal(calls.length, 0);
});

test('calling client requires authenticated tenant configuration', async () => {
  const { transport } = setup();
  const cfg = { backendUrl: 'https://api.example.test', tenantId: '', jwtToken: '' };
  const client = new CallingClient({ transport, getConfig: () => cfg });
  await assert.rejects(() => client.getNumberOptions(), /calling_auth_required/);
});

test('stale auth, tenant, or backend responses are rejected after identity change', async () => {
  const { cfg, transport } = setup();
  transport._request = async () => {
    cfg.tenantId = 'org_2';
    return { success: true };
  };
  const client = new CallingClient({ transport, getConfig: () => cfg });
  await assert.rejects(() => client.getNumberOptions(), /calling_stale_identity/);
});
