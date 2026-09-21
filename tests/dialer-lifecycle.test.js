const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture() {
  const sandbox = { console, crypto: { randomUUID: () => 'fixture-key' } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/dialer-ui.js'), 'utf8'), sandbox);
  const ui = Object.create(sandbox.DialerUI.prototype), elements = new Map(), stops = [];
  Object.assign(ui, { epoch: 0, active: true, ending: false, call: { call_id: 'call_fixture', state: 'prepared' },
    media: { close: async () => {} }, hooks: { stop: async (options) => stops.push(options) }, api: {},
    el: (id) => { if (!elements.has(id)) elements.set(id, { value: '', textContent: '', dataset: {}, replaceChildren() {} }); return elements.get(id); },
    controls() {}, option() {}, container: { hidden: false } });
  return { ui, stops, sandbox };
}

test('late confirmed end unlocks an already closed media session without stopping twice', async () => {
  const { ui, stops } = fixture();
  await ui.finish('interrupted');
  assert.equal(ui.call.state, 'reconciliation_required');
  await ui.finish('ended');
  assert.equal(ui.call.state, 'ended');
  assert.equal(stops.length, 1);
});

test('workspace reset never sends the old coaching session end under a new identity', async () => {
  const { ui, stops } = fixture();
  ui.api.callingMediaClose = async () => ({ success: true });
  await ui.reset();
  assert.equal(stops[0]?.endSession, false);
  assert.equal(ui.call, null);
  assert.equal(ui.price, null);
  assert.equal(ui.el('checkout').disabled, true);
});

test('failed signaling start closes the reserved call and local audio', async () => {
  const { ui, sandbox, stops } = fixture(); let closed = 0, mediaClosed = 0;
  ui.active = false; ui.media = null;
  sandbox.navigator = { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } };
  sandbox.CallMedia = class { async start() { return { type: 'offer', sdp: 'fixture' }; } async close() { mediaClosed++; } };
  ui.hooks.listen = async () => {};
  ui.api.callingMediaStart = async () => { throw new Error('connection_lost'); };
  ui.api.callingMediaClose = async () => { closed++; return { success: true }; };
  await assert.rejects(ui.start(), /connection_lost/);
  assert.equal(closed, 1); assert.equal(mediaClosed, 1); assert.equal(stops.length, 1);
  assert.equal(ui.call.state, 'reconciliation_required');
});

test('a late media-close cleanup cannot overwrite a newer terminal response', async () => {
  const { ui } = fixture(); let release;
  ui.media.close = () => new Promise((resolve) => { release = resolve; });
  const first = ui.finish('interrupted');
  await ui.finish('ended'); release(); await first;
  assert.equal(ui.call.state, 'ended');
});

test('repeated review while preparing creates one call record', async () => {
  const { ui } = fixture(); let requests = 0, release;
  ui.active = false; ui.call = null; ui.context = { person_id: 'person', context_snapshot_id: 'snapshot' };
  ui.numbers = [{ number_id: 'caller', local_only: true }]; ui.el('caller').value = 'caller';
  ui.script = () => ({ template_id: 'script', revision: 1 });
  ui.api.callingPrepareCall = async () => { requests++; await new Promise((resolve) => { release = resolve; }); return { success: true, call: { state: 'prepared', rendered_script: {} } }; };
  const first = ui.review();
  const second = ui.review();
  assert.equal(requests, 1);
  release(); await Promise.all([first, second]);
  assert.equal(ui.reviewing, false);
});

test('microphone denial leaves the prepared call retryable without a signaling request', async () => {
  const { ui, sandbox } = fixture(); ui.active = false; ui.media = null;
  sandbox.navigator = { mediaDevices: { getUserMedia: async () => { throw new Error('NotAllowedError'); } } };
  ui.api.callingMediaStart = async () => { assert.fail('microphone denial cannot dial'); };
  await assert.rejects(ui.start(), /NotAllowed/);
  assert.equal(ui.call.state, 'prepared'); assert.equal(ui.active, false);
});
