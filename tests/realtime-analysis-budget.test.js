const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFunction(file, start, end, globals) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'application function is available');
  return vm.runInNewContext(`(${source.slice(from, to).trim()})`, globals);
}

test('renderer coaching request keeps realtime budget and selected context', async () => {
  const state = {
    transcript: 'We need a shorter implementation timeline.',
    config: { analysisModel: 'gpt-5-mini' },
    activeReminder: { pipeline_id: 'pipeline_selected', event_id: 'event_selected' },
    pendingAnalysis: new Map(),
  };
  let sent;
  const analyze = loadFunction('index.html', 'async function runAnalysis(', 'async function startListening(', {
    state, hasAuth: () => true, setTimeout, clearTimeout,
    API: { sendAnalysisRequest(request) {
      sent = request;
      queueMicrotask(() => state.pendingAnalysis.get(request.id).resolve({ success: true }));
    } },
  });
  await analyze('Suggest the next question.', 'summary');
  assert.equal(sent.max_completion_tokens, 4000);
  assert.equal(sent.transcript, state.transcript);
  assert.equal(sent.pipeline_id, 'pipeline_selected');
  assert.equal(sent.event_id, 'event_selected');
  assert.equal(sent.analysisType, 'summary');
});

test('main IPC analysis defaults to realtime budget and preserves explicit budgets', async () => {
  let sent;
  const analyze = loadFunction('main.js', 'async function handleAnalyzeRequest(', 'function registerIpc(', {
    ensureHostedConfigured: () => ({ analysisModel: 'gpt-5-mini' }),
    hostedClient: { analyze: async (request) => { sent = request; return { success: true }; } },
  });
  await analyze({ transcript: 'A short buyer question.' });
  assert.equal(sent.maxCompletionTokens, 4000);
  await analyze({ transcript: 'A short buyer question.', maxCompletionTokens: 1000 });
  assert.equal(sent.maxCompletionTokens, 1000);
});

test('prepared-call analysis ignores a stale default pipeline but preserves explicit scope checks', async () => {
  let sent;
  const analyze = loadFunction('main.js', 'async function handleAnalyzeRequest(', 'function registerIpc(', {
    ensureHostedConfigured: () => ({ defaultPipelineId: 'unrelated_pipeline' }),
    hostedClient: { analyze: async (request) => { sent = request; } },
  });
  await analyze({ transcript: 'Buyer question.', callId: 'prepared_call' });
  assert.equal(sent.callId, 'prepared_call'); assert.equal(sent.pipelineId, undefined);
  await analyze({ transcript: 'Buyer question.' });
  assert.equal(sent.pipelineId, 'unrelated_pipeline');
  await analyze({ transcript: 'Buyer question.', callId: 'prepared_call', pipelineId: 'explicit_pipeline' });
  assert.equal(sent.pipelineId, 'explicit_pipeline');
});

test('workspace reset removes old transcript, call binding and pending coaching', async () => {
  let rejected = false, callback;
  const state = { listening: false, transcript: 'Previous workspace transcript', transcriptSegments: ['Previous'],
    callId: 'old_call', activeReminder: { pipeline_id: 'old_pipeline' }, clarificationPrompts: ['Old question'],
    pendingAnalysis: new Map([['old', { reject() { rejected = true; } }]]) };
  const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const from = source.indexOf('API.onAuthUpdated(async (msg) => {');
  const to = source.indexOf('API.onQuickAsk(', from);
  vm.runInNewContext(source.slice(from, to), { state, dialer: null,
    API: { onAuthUpdated(fn) { callback = fn; } }, renderClarifyButtons() {},
    stopListening: async () => {}, refreshConfigAndAuth: async () => {} });
  await callback({ configChanged: true });
  assert.equal(state.transcript, ''); assert.equal(state.transcriptSegments.length, 0);
  assert.equal(state.callId, null); assert.equal(state.activeReminder, null);
  assert.equal(state.clarificationPrompts.length, 0);
  assert.equal(state.pendingAnalysis.size, 0); assert.ok(rejected);
});
