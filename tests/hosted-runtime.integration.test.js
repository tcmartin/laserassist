const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { WebSocketServer } = require('ws');

const { HostedApiClient } = require('../src/hosted-client');
const { HostedAudioTranscriber } = require('../src/hosted-audio');

function createMockBackend() {
  const calls = {
    transcribeHttp: 0,
    analyzeHttp: 0,
    transcribeWs: 0,
    analyzeWs: 0,
    reminders: 0,
    sessions: 0,
  };

  const server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const body = Buffer.concat(parts);

      if (req.url.startsWith('/api/abm/intelli/reminders')) {
        calls.reminders += 1;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          success: true,
          reminders: [
            {
              event_id: 'evt_live_1',
              pipeline_id: 'pipe_live_1',
              person_name: 'Dana Prospect',
              company_name: 'Northstar',
              scheduled_at: '2026-02-12T16:00:00Z',
            },
          ],
          count: 1,
        }));
        return;
      }

      if (req.url === '/api/abm/intelli/transcribe') {
        calls.transcribeHttp += 1;
        assert.ok(body.length > 44, 'WAV payload should include audio body');
        assert.equal(body.slice(0, 4).toString('ascii'), 'RIFF');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, transcript: 'prospect asked about pricing and security' }));
        return;
      }

      if (req.url === '/api/abm/intelli/analyze') {
        calls.analyzeHttp += 1;
        const parsed = JSON.parse(body.toString('utf8'));
        assert.ok(parsed.transcript.includes('pricing'));
        assert.ok(parsed.max_completion_tokens);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          success: true,
          text: 'analysis complete',
          parsed: {
            summary: 'Prospect cares about pricing and security sign-off.',
            next_best_actions: ['Show enterprise security controls', 'Share ROI case study'],
          },
        }));
        return;
      }

      if (req.url === '/api/abm/intelli/sessions/start') {
        calls.sessions += 1;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (req.url.includes('/api/abm/intelli/sessions/') && req.url.endsWith('/events')) {
        calls.sessions += 1;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (req.url.includes('/api/abm/intelli/sessions/') && req.url.endsWith('/end')) {
        calls.sessions += 1;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (req.url.includes('/api/abm/intelli/sessions/')) {
        calls.sessions += 1;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, session: { session_id: 'sess_test' } }));
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
      calls.transcribeWs += 1;
      ws.send(JSON.stringify({
        op: 'transcript',
        request_id: msg.request_id,
        success: true,
        transcript: 'prospect asked about pricing and security',
        provider: 'deepgram',
        confidence: 0.98,
      }));
    });
  });

  const analysisWss = new WebSocketServer({ noServer: true });
  analysisWss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw || '{}'));
      calls.analyzeWs += 1;
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
        text: 'analysis complete',
        parsed: {
          summary: 'Prospect cares about pricing and security sign-off.',
          next_best_actions: ['Show enterprise security controls', 'Share ROI case study'],
        },
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
    calls,
    close: () => {
      asrWss.close();
      analysisWss.close();
      server.close();
    },
  };
}

test('Hosted runtime integration: reminders + live transcription + analysis + session flow', async () => {
  const { server, calls, close } = createMockBackend();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const cfg = {
    backendUrl: `http://127.0.0.1:${port}`,
    tenantId: 'orgl',
    jwtToken: 'token_xyz',
    lookaheadMinutes: 30,
    analysisModel: 'gpt-5-mini',
    defaultPipelineId: 'pipe_live_1',
  };

  const client = new HostedApiClient({ getConfig: () => cfg, fetchImpl: fetch });

  const reminders = await client.getReminders();
  assert.equal(reminders.success, true);
  assert.equal(reminders.count, 1);

  const transcripts = [];
  const asrErrors = [];
  const transcriber = new HostedAudioTranscriber({
    transcribeFn: (wav) => client.transcribeWav(wav),
    onTranscript: (msg) => transcripts.push(msg.text),
    onError: (msg) => asrErrors.push(msg.message),
    flushIntervalMs: 60,
    minBytes: 5000,
  });

  await client.sessionStart({ sessionId: 'sess_test', metadata: { source: 'integration' } });

  transcriber.start({ sampleRate: 48000, flushIntervalMs: 60 });

  for (let i = 0; i < 12; i += 1) {
    const chunk = new Float32Array(4096);
    for (let j = 0; j < chunk.length; j += 1) {
      chunk[j] = Math.sin((i * chunk.length + j) / 25);
    }
    transcriber.addFloat32Chunk(chunk);
  }

  await new Promise((resolve) => setTimeout(resolve, 220));
  await transcriber.stop();

  assert.equal(asrErrors.length, 0, `Unexpected ASR errors: ${asrErrors.join(' | ')}`);
  assert.ok(transcripts.length >= 1);

  await client.sessionAppendEvent({
    sessionId: 'sess_test',
    type: 'transcript',
    payload: { text: transcripts.join('\n') },
  });

  const analysis = await client.analyze({
    transcript: transcripts.join('\n'),
    analysisType: 'full',
    maxCompletionTokens: 12000,
    model: 'gpt-5-mini',
    pipelineId: 'pipe_live_1',
  });
  assert.equal(analysis.success, true);
  assert.ok(analysis.parsed.summary.includes('pricing'));

  await client.sessionAppendEvent({
    sessionId: 'sess_test',
    type: 'analysis',
    payload: analysis.parsed,
  });
  await client.sessionEnd({ sessionId: 'sess_test', metadata: { done: true } });
  await client.closeAsrStream();
  await client.closeAnalysisStream();

  assert.ok(calls.reminders >= 1);
  assert.ok(calls.transcribeWs >= 1);
  assert.ok(calls.analyzeWs >= 1);
  assert.equal(calls.transcribeHttp, 0);
  assert.equal(calls.analyzeHttp, 0);
  assert.ok(calls.sessions >= 3);

  close();
});
