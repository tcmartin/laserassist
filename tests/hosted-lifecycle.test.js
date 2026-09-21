const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocketServer } = require('ws');

const { HostedAudioTranscriber } = require('../src/hosted-audio');
const { HostedApiClient } = require('../src/hosted-client');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createLoopbackSocketServer({ delayFirstUpgradeMs = 0, closeFirstAfterMs = 0 } = {}) {
  const connections = [];
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const connection = {
      query: new URL(`http://loopback${req.url}`).searchParams,
      socket,
      ws: null,
      messages: [],
    };
    const index = connections.push(connection) - 1;
    const accept = () => {
      if (socket.destroyed) return;
      wss.handleUpgrade(req, socket, head, (ws) => {
        connection.ws = ws;
        ws.on('message', (raw) => {
          const msg = JSON.parse(String(raw || '{}'));
          connection.messages.push(msg);
          if (msg.op === 'audio') {
            ws.send(JSON.stringify({
              op: 'transcript',
              request_id: msg.request_id,
              success: true,
              transcript: `connection-${index}`,
            }));
          } else if (msg.op === 'stream_start') {
            ws.send(JSON.stringify({
              op: 'stream_started',
              request_id: msg.request_id,
              success: true,
              stream_id: `stream-${index}`,
            }));
          } else if (msg.op === 'stream_end') {
            ws.send(JSON.stringify({
              op: 'stream_ended',
              request_id: msg.request_id,
              success: true,
              stream_id: `stream-${index}`,
            }));
          } else if (msg.op === 'session_start') {
            ws.send(JSON.stringify({
              op: 'session_started',
              request_id: msg.request_id,
              success: true,
              session: { session_id: msg.session_id, connection: index },
            }));
          } else if (msg.op === 'session_append') {
            ws.send(JSON.stringify({
              op: 'session_appended',
              request_id: msg.request_id,
              success: true,
              event_count: 1,
            }));
          } else if (msg.op === 'session_end') {
            ws.send(JSON.stringify({
              op: 'session_ended',
              request_id: msg.request_id,
              success: true,
              session: { session_id: msg.session_id, connection: index },
            }));
          } else if (msg.op === 'session_get') {
            ws.send(JSON.stringify({
              op: 'session',
              request_id: msg.request_id,
              success: true,
              session: { session_id: msg.session_id, connection: index },
            }));
          }
        });
      });
      if (index === 0 && closeFirstAfterMs) {
        setTimeout(() => {
          try { ws.close(); } catch (_) {}
        }, closeFirstAfterMs);
      }
    };
    if (index === 0 && delayFirstUpgradeMs) setTimeout(accept, delayFirstUpgradeMs);
    else accept();
  });

  return {
    server,
    connections,
    async listen() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      return server.address().port;
    },
    close() {
      for (const connection of connections) {
        try { connection.ws?.close(); } catch (_) {}
        try { connection.socket?.destroy(); } catch (_) {}
      }
      wss.close();
      server.close();
    },
  };
}

test('HostedAudioTranscriber stop force-flushes audio after stream startup', async () => {
  const startup = deferred();
  const sent = [];
  const transcriber = new HostedAudioTranscriber({
    startStreamFn: () => startup.promise,
    sendPcmChunkFn: async (pcm) => { sent.push(pcm); },
    stopStreamFn: async () => {},
    minBytes: 4000,
    flushIntervalMs: 1000,
  });

  transcriber.start();
  transcriber.addFloat32Chunk(new Float32Array(1000).fill(0.2));
  const stopping = transcriber.stop();
  await wait(10);
  assert.equal(sent.length, 0);

  startup.resolve({ success: true, streamId: 'stream-1' });
  await stopping;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 2000);
});

test('HostedAudioTranscriber ignores an old start callback after a reentrant start', async () => {
  const first = deferred();
  const second = deferred();
  const starts = [];
  const sent = [];
  const transcriber = new HostedAudioTranscriber({
    startStreamFn: () => {
      const startup = starts.length === 0 ? first : second;
      starts.push(startup);
      return startup.promise;
    },
    sendPcmChunkFn: async (pcm) => { sent.push(pcm); },
    stopStreamFn: async () => {},
    minBytes: 1600,
    flushIntervalMs: 1000,
  });

  transcriber.start();
  transcriber.start();
  transcriber.addFloat32Chunk(new Float32Array(1000).fill(0.2));
  first.resolve({ success: true, streamId: 'old' });
  await wait(20);
  assert.equal(sent.length, 0);

  second.resolve({ success: true, streamId: 'new' });
  await transcriber.stop();
  assert.equal(sent.length, 1);
});

test('HostedApiClient reconnects WebSocket when auth or organization changes', async () => {
  const loopback = createLoopbackSocketServer();
  const port = await loopback.listen();
  const cfg = {
    backendUrl: `http://127.0.0.1:${port}`,
    tenantId: 'org-1',
    jwtToken: 'token-1',
  };
  const client = new HostedApiClient({ getConfig: () => cfg });

  try {
    const first = await client.transcribeWav(Buffer.from('one'));
    cfg.tenantId = 'org-2';
    cfg.jwtToken = 'token-2';
    const second = await client.transcribeWav(Buffer.from('two'));

    assert.equal(first.transcript, 'connection-0');
    assert.equal(second.transcript, 'connection-1');
    assert.equal(loopback.connections.length, 2);
    assert.equal(loopback.connections[0].query.get('tenant_id'), 'org-1');
    assert.equal(loopback.connections[0].query.get('token'), 'token-1');
    assert.equal(loopback.connections[1].query.get('tenant_id'), 'org-2');
    assert.equal(loopback.connections[1].query.get('token'), 'token-2');
  } finally {
    await client.closeAsrStream();
    loopback.close();
  }
});

test('HostedApiClient ignores a late close from the replaced socket', async () => {
  const loopback = createLoopbackSocketServer({ closeFirstAfterMs: 120 });
  const port = await loopback.listen();
  const cfg = {
    backendUrl: `http://127.0.0.1:${port}`,
    tenantId: 'org-1',
    jwtToken: 'token-1',
  };
  const client = new HostedApiClient({ getConfig: () => cfg });

  try {
    await client.transcribeWav(Buffer.from('one'));
    cfg.tenantId = 'org-2';
    cfg.jwtToken = 'token-2';
    await client.transcribeWav(Buffer.from('two'));
    await wait(180);
    const third = await client.transcribeWav(Buffer.from('three'));

    assert.equal(third.transcript, 'connection-1');
    assert.equal(loopback.connections.length, 2);
  } finally {
    await client.closeAsrStream();
    loopback.close();
  }
});

test('HostedApiClient close invalidates a pending loopback WebSocket connection', async () => {
  const loopback = createLoopbackSocketServer({ delayFirstUpgradeMs: 150 });
  const port = await loopback.listen();
  const cfg = {
    backendUrl: `http://127.0.0.1:${port}`,
    tenantId: 'org-1',
    jwtToken: 'token-1',
  };
  const client = new HostedApiClient({ getConfig: () => cfg });

  try {
    const connecting = client.ensureAsrStream();
    await wait(15);
    await client.closeAsrStream();
    await assert.rejects(connecting, /closed|connect/);

    const out = await client.transcribeWav(Buffer.from('fresh'));
    assert.equal(out.transcript, 'connection-1');
    assert.equal(loopback.connections.length, 2);
  } finally {
    await client.closeAsrStream();
    loopback.close();
  }
});

test('HostedApiClient reconnects the analysis session channel without stale tenant sends', async () => {
  const loopback = createLoopbackSocketServer();
  const port = await loopback.listen();
  const cfg = {
    backendUrl: `http://127.0.0.1:${port}`,
    tenantId: 'org-1',
    jwtToken: 'token-1',
  };
  const client = new HostedApiClient({ getConfig: () => cfg });

  try {
    const first = await client.sessionStart({ sessionId: 'session-1' });
    cfg.tenantId = 'org-2';
    cfg.jwtToken = 'token-2';
    const second = await client.sessionAppendEvent({
      sessionId: 'session-1',
      type: 'transcript',
      payload: { text: 'new tenant event' },
    });

    assert.equal(first.session.connection, 0);
    assert.equal(second.event_count, 1);
    assert.equal(loopback.connections.length, 2);
    assert.equal(loopback.connections[0].query.get('tenant_id'), 'org-1');
    assert.equal(loopback.connections[0].query.get('token'), 'token-1');
    assert.equal(loopback.connections[1].query.get('tenant_id'), 'org-2');
    assert.equal(loopback.connections[1].query.get('token'), 'token-2');
    assert.deepEqual(loopback.connections[0].messages.map((msg) => msg.op), ['session_start']);
    assert.deepEqual(loopback.connections[1].messages.map((msg) => msg.op), ['session_append']);
  } finally {
    await client.closeAnalysisStream();
    loopback.close();
  }
});
