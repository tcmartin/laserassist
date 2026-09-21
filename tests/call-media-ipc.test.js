const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('main process reserves one call before awaiting connection and scopes every media operation', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const start = source.indexOf('function mediaPayload(');
  const end = source.indexOf('function cleanup()', start);
  assert.ok(start >= 0 && end > start);
  const instances = [];
  let finish;
  class FakeSignaling {
    constructor(options) { this.options = options; this.callId = options.callId; this.closed = false; instances.push(this); }
    start() { return new Promise((resolve) => { finish = resolve; }); }
    close() { this.closed = true; this.options.onClose({ call_id: this.callId, state: 'connected' }); }
  }
  const globals = { Buffer, CallSignaling: FakeSignaling, callSignaling: null,
    ensureHostedConfigured: () => {}, hostedConfigStore: { get: () => ({}) }, safeSend: () => {} };
  const functions = vm.runInNewContext(`${source.slice(start, end)};({startCallingMedia,currentCallingMedia});`, globals);
  const payload = { callId: `call_${'a'.repeat(64)}`, offer: { type: 'offer', sdp: 'synthetic' } };
  const first = functions.startCallingMedia(payload);
  await assert.rejects(functions.startCallingMedia(payload), /calling_call_in_progress/);
  assert.equal(instances.length, 1);
  assert.throws(() => functions.currentCallingMedia({ callId: `call_${'b'.repeat(64)}` }), /calling_media_not_connected/);
  assert.throws(() => functions.currentCallingMedia({ callId: payload.callId, account: 'override' }), /calling_invalid_media_request/);
  finish({ success: true });
  await first;
  assert.equal(functions.currentCallingMedia({ callId: payload.callId }), instances[0]);
  instances[0].close();
  assert.equal(globals.callSignaling, null);
  assert.throws(() => functions.currentCallingMedia({ callId: payload.callId }), /calling_media_not_connected/);
});

test('main rejects malformed and oversized offers before constructing signaling', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const start = source.indexOf('function mediaPayload(');
  const end = source.indexOf('function cleanup()', start);
  let constructed = 0;
  const globals = { Buffer, callSignaling: null, CallSignaling: class { constructor() { constructed++; } },
    ensureHostedConfigured: () => {}, hostedConfigStore: { get: () => ({}) }, safeSend: () => {} };
  const startCall = vm.runInNewContext(`${source.slice(start, end)};startCallingMedia;`, globals);
  const callId = `call_${'a'.repeat(64)}`;
  await assert.rejects(startCall({ callId, offer: { type: 'answer', sdp: 'no' } }), /calling_invalid_offer/);
  await assert.rejects(startCall({ callId, offer: { type: 'offer', sdp: 'x'.repeat(129 * 1024) } }), /calling_invalid_offer/);
  await assert.rejects(startCall({ callId, offer: { type: 'offer', sdp: 'x' }, destination: '+15555550101' }), /calling_invalid_media_request/);
  assert.equal(constructed, 0);
});
