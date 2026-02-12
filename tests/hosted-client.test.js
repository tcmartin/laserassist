const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

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

      if (req.url === '/api/abm/intelli/analyze') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, text: 'analysis text', parsed: { summary: 'ok' } }));
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

  return { server, requests };
}

test('HostedApiClient calls hosted endpoints with required headers', async () => {
  const { server, requests } = createServer();

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

  await client.sessionStart({ sessionId: 'sess_1', metadata: { source: 'test' } });
  await client.sessionAppendEvent({ sessionId: 'sess_1', type: 'analysis', payload: { x: 1 } });
  await client.sessionEnd({ sessionId: 'sess_1', metadata: { ok: true } });
  const session = await client.sessionGet('sess_1');
  assert.equal(session.success, true);

  assert.ok(requests.length >= 6);
  for (const req of requests) {
    assert.equal(req.headers['x-org-id'], 'orgl');
    assert.equal(req.headers['authorization'], 'Bearer token123');
  }

  server.close();
});
