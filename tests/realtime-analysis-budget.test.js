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

test('standalone analysis uses configured pipeline and preserves explicit scope', async () => {
  let sent;
  const analyze = loadFunction('main.js', 'async function handleAnalyzeRequest(', 'function registerIpc(', {
    ensureHostedConfigured: () => ({ defaultPipelineId: 'unrelated_pipeline' }),
    hostedClient: { analyze: async (request) => { sent = request; } },
  });
  await analyze({ transcript: 'Buyer question.' });
  assert.equal(sent.callId, undefined); assert.equal(sent.pipelineId, 'unrelated_pipeline');
  await analyze({ transcript: 'Buyer question.', pipelineId: 'explicit_pipeline' });
  assert.equal(sent.pipelineId, 'explicit_pipeline');
});

test('workspace reset removes old transcript and pending coaching', async () => {
  let rejected = false, callback;
  const state = { listening: false, transcript: 'Previous workspace transcript', transcriptSegments: ['Previous'],
    activeReminder: { pipeline_id: 'old_pipeline' }, clarificationPrompts: ['Old question'],
    pendingAnalysis: new Map([['old', { reject() { rejected = true; } }]]) };
  const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const from = source.indexOf('API.onAuthUpdated(async (msg) => {');
  const to = source.indexOf('API.onQuickAsk(', from);
  vm.runInNewContext(source.slice(from, to), { state,
    API: { onAuthUpdated(fn) { callback = fn; } }, renderClarifyButtons() {},
    stopListening: async () => {}, refreshConfigAndAuth: async () => {} });
  await callback({ configChanged: true });
  assert.equal(state.transcript, ''); assert.equal(state.transcriptSegments.length, 0);
  assert.equal(state.activeReminder, null);
  assert.equal(state.clarificationPrompts.length, 0);
  assert.equal(state.pendingAnalysis.size, 0); assert.ok(rejected);
});

for (const nextSession of [null, 'new-session']) {
  test(`late automatic coaching cannot reopen a stopped or replaced session (${nextSession})`, async () => {
    let finish;
    let opened = 0;
    const state = { autoInsightEnabled: true, listening: true, sessionId: 'old-session',
      autoInsightInFlight: false, transcript: 'A'.repeat(100), autoInsightMinChars: 80,
      autoInsightLastAnalyzedLen: 0, autoInsightLastRunAt: 0 };
    const run = loadFunction('index.html', 'async function runAutoInsightIfReady(', 'function queueAutoInsight(', {
      state, autoInsightPrompt: () => 'Coach',
      runAnalysis: () => new Promise((resolve) => { finish = resolve; }),
      openAnalysisPanels: async () => { opened += 1; },
    });
    const pending = run();
    state.listening = Boolean(nextSession);
    state.sessionId = nextSession;
    state.autoInsightInFlight = Boolean(nextSession);
    finish({ summary: 'Stale answer' });
    await pending;
    assert.equal(opened, 0);
    assert.equal(state.autoInsightLastAnalyzedLen, 0);
    assert.equal(state.autoInsightInFlight, Boolean(nextSession));
  });
}

test('late analysis response never appends results to a different session', () => {
  let callback; let resolved = false; const appended = [];
  const state = { listening: true, sessionId: 'new-session', pendingAnalysis: new Map([
    ['old-request', { sessionId: 'old-session', resolve() { resolved = true; } }],
  ]) };
  const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const from = source.indexOf('API.onAnalysisResponse((event) => {');
  const to = source.indexOf('API.onResponse(', from);
  vm.runInNewContext(source.slice(from, to), { state, nowIso: () => 'now', API: {
    onAnalysisResponse(fn) { callback = fn; },
    sessionAppendAnalysis(...args) { appended.push(args); },
  } });
  callback({ data: { id: 'old-request', results: { summary: 'Old audio' } } });
  assert.equal(resolved, true);
  assert.equal(appended.length, 0);
});
