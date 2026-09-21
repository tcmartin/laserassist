const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
const { CallSignaling } = require('../src/call-signaling');
const callId = `call_${'a'.repeat(64)}`;

async function fixture(t, handle, options = {}) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  const config = { backendUrl: `http://127.0.0.1:${server.address().port}`, tenantId: 'synthetic_org', jwtToken: 'fixture_token' };
  const messages = [];
  const updates = [];
  const closes = [];
  server.on('connection', (socket, request) => {
    const url = new URL(request.url, config.backendUrl);
    assert.equal(url.pathname, `/api/abm/intelli/calls/${callId}/media/ws`);
    assert.equal(url.searchParams.get('tenant_id'), 'synthetic_org');
    assert.equal(url.searchParams.get('token'), 'fixture_token');
    socket.on('message', (raw) => {
      const message = JSON.parse(raw);
      messages.push(message);
      handle(socket, message);
    });
  });
  const client = new CallSignaling({ callId, getConfig: () => config,
    onUpdate: (update) => updates.push(update), onClose: (closed) => closes.push(closed), ...options });
  t.after(async () => {
    client.close();
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  return { client, config, messages, updates, closes };
}
function reply(socket, message, fields = {}) {
  socket.send(JSON.stringify({ success: true, call_id: callId, request_id: message.request_id, state: 'connected', ...fields }));
}

test('authenticated call socket serializes mutations, forwards events and ends once', async (t) => {
  let active = 0;
  let maxActive = 0;
  const { client, messages, updates, closes } = await fixture(t, (socket, message) => {
    maxActive = Math.max(maxActive, ++active);
    setTimeout(() => {
      active--;
      reply(socket, message, { state: message.op === 'end' ? 'ended' : 'connected', events: [{ type: 'accepted' }] });
    }, 10);
  }, { pollMs: 10000 });
  await client.start({ type: 'offer', sdp: 'synthetic' });
  await assert.rejects(client.start({ type: 'offer', sdp: 'duplicate' }), /already_started/);
  await Promise.all([client.trickle({ candidate: 'one', sdpMid: '0' }), client.trickle(null)]);
  const end = await client.end();
  assert.equal(end.state, 'ended');
  assert.equal(maxActive, 1);
  assert.deepEqual(messages.map((message) => message.op), ['start', 'trickle', 'trickle', 'end']);
  assert.equal(updates.length, 4);
  assert.equal(closes.length, 1);
  assert.equal(client.closed, true);
});

test('polling delivers remote media events and stops at remote hangup', async (t) => {
  const { client, messages, updates } = await fixture(t, (socket, message) => {
    reply(socket, message, message.op === 'poll'
      ? { state: 'ended', events: [{ type: 'hangup', state: 'ended' }] } : {});
  }, { pollMs: 50 });
  await client.start({ type: 'offer', sdp: 'synthetic' });
  await new Promise((resolve) => setTimeout(resolve, 130));
  assert.equal(messages.filter((message) => message.op === 'poll').length, 1);
  assert.equal(updates.at(-1).events[0].type, 'hangup');
  assert.equal(client.closed, true);
});

test('changed identity closes transport before a subsequent command', async (t) => {
  const { client, config, messages } = await fixture(t, reply, { pollMs: 10000 });
  await client.start({ type: 'offer', sdp: 'synthetic' });
  config.tenantId = 'another_org';
  await assert.rejects(client.trickle(null), /identity_changed/);
  assert.equal(messages.length, 1);
  assert.equal(client.closed, true);
});

test('uncertain start timeout never reconnects or retries external operation', async (t) => {
  const { client, messages } = await fixture(t, () => {}, { timeoutMs: 100 });
  await assert.rejects(client.start({ type: 'offer', sdp: 'synthetic' }), /timeout/);
  await assert.rejects(client.start({ type: 'offer', sdp: 'again' }), /closed/);
  assert.equal(messages.length, 1);
  assert.equal(client.closed, true);
});

test('wrong call responses and oversized requests fail before exposing data or sending payload', async (t) => {
  const { client, messages, updates } = await fixture(t, (socket, message) => reply(socket, message, { call_id: `call_${'b'.repeat(64)}` }));
  await assert.rejects(client.start({ type: 'offer', sdp: 'synthetic' }), /scope_mismatch/);
  assert.equal(updates.length, 0);
  assert.equal(messages.length, 1);
  const second = await fixture(t, reply);
  await assert.rejects(second.client.start({ type: 'offer', sdp: 'x'.repeat(170 * 1024) }), /payload_too_large/);
  assert.equal(second.messages.length, 0);
});
