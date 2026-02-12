const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { WebSocketServer } = require('ws');

const { HostedApiClient } = require('../src/hosted-client');

function createServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });

      if (req.url.startsWith('/api/abm/intelli/reminders')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, reminders: [{ event_id: 'evt_1' }], count: 1 }));
        return;
      }

      if (req.url === '/api/abm/intelli/transcribe') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, transcript: 'hello world' }));
        return;
      }

      if (req.url === '/user/me') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ username: 'trevor', email: 'trevor@example.com' }));
        return;
      }

      if (req.url === '/me/orgs') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify([{ org_id: 'orgl', name: 'Laserreach Org' }]));
        return;
      }

      if (req.url === '/api/abm/intelli/sessions/start') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (req.url.includes('/api/abm/intelli/sessions/') && req.url.endsWith('/events')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (req.url.includes('/api/abm/intelli/sessions/') && req.url.endsWith('/end')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (req.url.includes('/api/abm/intelli/sessions/')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, session: { session_id: 'sess_1' } }));
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    });
  });

  const asrWss = new WebSocketServer({ noServer: true });
  asrWss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw || '{}'));
      ws.send(JSON.stringify({
        op: 'transcript',
        request_id: msg.request_id,
        success: true,
        transcript: 'hello world',
        provider: 'deepgram',
        confidence: 0.99,
      }));
    });
  });

  const analysisWss = new WebSocketServer({ noServer: true });
  analysisWss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw || '{}'));
      ws.send(JSON.stringify({
        op: 'analysis_status',
        request_id: msg.request_id,
        success: true,
        status: 'running',
        message: 'running',
      }));
      ws.send(JSON.stringify({
        op: 'analysis_status',
        request_id: msg.request_id,
        success: true,
        status: 'done',
        message: 'done',
      }));
      ws.send(JSON.stringify({
        op: 'analysis_result',
        request_id: msg.request_id,
        success: true,
        text: 'analysis text',
        parsed: { summary: 'ok' },
        usage: { total_tokens: 11 },
      }));
    });
  });

  server.on('upgrade', (req, socket, head) => {
    if (String(req.url || '').startsWith('/api/abm/intelli/transcribe/ws')) {
      asrWss.handleUpgrade(req, socket, head, (ws) => asrWss.emit('connection', ws, req));
      return;
    }
    if (String(req.url || '').startsWith('/api/abm/intelli/analyze/ws')) {
      analysisWss.handleUpgrade(req, socket, head, (ws) => analysisWss.emit('connection', ws, req));
      return;
    }
    socket.destroy();
  });

  return {
    server,
    requests,
    close: () => {
      asrWss.close();
      analysisWss.close();
      server.close();
    },
  };
}

test('HostedApiClient calls hosted endpoints with required headers', async () => {
  const { server, requests, close } = createServer();

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const cfg = {
      backendUrl: `http://127.0.0.1:${port}`,
      tenantId: 'orgl',
      jwtToken: 'token123',
      lookaheadMinutes: 45,
      analysisModel: 'gpt-5-mini',
      defaultPipelineId: 'pipe_1',
    };

    const client = new HostedApiClient({ getConfig: () => cfg, fetchImpl: fetch });

    const reminders = await client.getReminders();
    assert.equal(reminders.success, true);
    assert.equal(reminders.count, 1);

    const transcribed = await client.transcribeWav(Buffer.from('wav_data'));
    assert.equal(transcribed.transcript, 'hello world');

    const analyzed = await client.analyze({ transcript: 'abc', analysisType: 'summary' });
    assert.equal(analyzed.success, true);
    assert.equal(analyzed.parsed.summary, 'ok');

    const me = await client.getUser();
    assert.equal(me.username, 'trevor');

    const orgs = await client.getOrgs();
    assert.equal(Array.isArray(orgs), true);
    assert.equal(orgs[0].org_id, 'orgl');

    await client.sessionStart({ sessionId: 'sess_1', metadata: { source: 'test' } });
    await client.sessionAppendEvent({ sessionId: 'sess_1', type: 'analysis', payload: { x: 1 } });
    await client.sessionEnd({ sessionId: 'sess_1', metadata: { ok: true } });
    const session = await client.sessionGet('sess_1');
    assert.equal(session.success, true);

    assert.ok(requests.length >= 6);
    const httpRequests = requests.filter((req) => !String(req.url || '').startsWith('/api/abm/intelli/transcribe/ws'));
    for (const req of httpRequests) {
      assert.equal(req.headers['x-org-id'], 'orgl');
      assert.equal(req.headers['authorization'], 'Bearer token123');
    }
    await client.closeAsrStream();
    await client.closeAnalysisStream();
  } finally {
    close();
  }
});

test('HostedApiClient retries localhost network failures via 127.0.0.1 fallback', async () => {
  const { server, close } = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const cfg = {
    backendUrl: `http://localhost:${port}`,
    tenantId: 'orgl',
    jwtToken: 'token123',
  };

  const calls = [];
  const fetchWithForcedLocalhostFailure = async (url, options) => {
    calls.push(String(url));
    if (String(url).startsWith(`http://localhost:${port}`)) {
      throw new TypeError('fetch failed');
    }
    return fetch(url, options);
  };

  const client = new HostedApiClient({
    getConfig: () => cfg,
    fetchImpl: fetchWithForcedLocalhostFailure,
  });

  const reminders = await client.getReminders();
  assert.equal(reminders.success, true);
  assert.ok(calls.some((u) => u.startsWith(`http://localhost:${port}`)));
  assert.ok(calls.some((u) => u.startsWith(`http://127.0.0.1:${port}`)));

  close();
});

test('HostedApiClient retries websocket connect from ::1 to IPv4 localhost', async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body: Buffer.concat(chunks) });
      res.statusCode = 404;
      res.end('not found');
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/api/abm/intelli/transcribe/ws')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw || '{}'));
        ws.send(JSON.stringify({
          op: 'transcript',
          request_id: msg.request_id,
          success: true,
          transcript: 'ipv4 fallback transcript',
          provider: 'deepgram',
          confidence: 0.99,
        }));
      });
    });
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const cfg = {
      backendUrl: `http://[::1]:${port}`,
      tenantId: 'orgl',
      jwtToken: 'token123',
    };
    const client = new HostedApiClient({ getConfig: () => cfg, fetchImpl: fetch });

    const out = await client.transcribeWav(Buffer.from('wav_data'));
    assert.equal(out.success, true);
    assert.equal(out.transcript, 'ipv4 fallback transcript');

    await client.closeAsrStream();
  } finally {
    wss.close();
    server.close();
  }
});

test('HostedApiClient surfaces path and backend in network errors', async () => {
  const cfg = {
    backendUrl: 'http://localhost:65534',
    tenantId: 'orgl',
    jwtToken: 'token123',
  };
  const client = new HostedApiClient({
    getConfig: () => cfg,
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });

  await assert.rejects(
    async () => client.transcribeWav(Buffer.from('wav_data')),
    /asr_ws_error:/,
  );
});

test('HostedApiClient prefers websocket ASR transport when backend websocket is available', async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body: Buffer.concat(chunks) });
      if (req.url === '/api/abm/intelli/transcribe') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, transcript: 'http fallback transcript' }));
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/api/abm/intelli/transcribe/ws')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw || '{}'));
        ws.send(JSON.stringify({
          op: 'transcript',
          request_id: msg.request_id,
          success: true,
          transcript: 'websocket transcript',
          provider: 'deepgram',
          confidence: 0.99,
        }));
      });
    });
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const cfg = {
      backendUrl: `http://127.0.0.1:${port}`,
      tenantId: 'orgl',
      jwtToken: 'token123',
    };
    const client = new HostedApiClient({ getConfig: () => cfg, fetchImpl: fetch });

    const out = await client.transcribeWav(Buffer.from('wav_data'));
    assert.equal(out.success, true);
    assert.equal(out.transcript, 'websocket transcript');
    assert.equal(requests.filter((r) => r.url === '/api/abm/intelli/transcribe').length, 0);

    await client.closeAsrStream();
  } finally {
    wss.close();
    server.close();
  }
});

test('HostedApiClient emits analysis websocket status updates', async () => {
  const { server, close } = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const statuses = [];
  const cfg = {
    backendUrl: `http://127.0.0.1:${port}`,
    tenantId: 'orgl',
    jwtToken: 'token123',
  };
  try {
    const client = new HostedApiClient({
      getConfig: () => cfg,
      fetchImpl: fetch,
      onStatus: (s) => statuses.push(s),
    });

    const out = await client.analyze({
      transcript: 'pricing and security discussion',
      analysisType: 'full',
      maxCompletionTokens: 1000,
      model: 'gpt-5-mini',
    });
    assert.equal(out.success, true);
    assert.equal((out.parsed || {}).summary, 'ok');
    assert.ok(statuses.some((s) => s.type === 'analysis-status' && s.status === 'running'));
    assert.ok(statuses.some((s) => s.type === 'analysis-status' && s.status === 'done'));
    await client.closeAsrStream();
    await client.closeAnalysisStream();
  } finally {
    close();
  }
});

test('HostedApiClient waits out websocket cooldown instead of hard-failing ASR', async () => {
  const { server, close } = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const cfg = {
    backendUrl: `http://127.0.0.1:${port}`,
    tenantId: 'orgl',
    jwtToken: 'token123',
  };

  try {
    const client = new HostedApiClient({
      getConfig: () => cfg,
      fetchImpl: fetch,
    });

    // Simulate a reconnect backoff window from a prior transient socket error.
    client._asrSocketDisabledUntil = Date.now() + 80;

    const startedAt = Date.now();
    const out = await client.transcribeWav(Buffer.from('wav_data'));
    const elapsed = Date.now() - startedAt;

    assert.equal(out.success, true);
    assert.equal(out.transcript, 'hello world');
    assert.ok(elapsed >= 50);

    await client.closeAsrStream();
    await client.closeAnalysisStream();
  } finally {
    close();
  }
});
