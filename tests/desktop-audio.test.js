const test = require('node:test');
const assert = require('node:assert/strict');
const { DesktopAudioCapture } = require('../src/desktop-audio');
const { installDisplayCapture } = require('../src/display-capture');
const { normalizeConfig } = require('../src/hosted-config');

function fixture() {
  const all = [];
  const stream = (audio = true) => {
    const track = { readyState: 'live', stop() { this.readyState = 'ended'; },
      addEventListener(name, fn) { this[name] = fn; } };
    const value = { getAudioTracks: () => audio ? [track] : [], getTracks: () => [track] };
    all.push(value);
    return value;
  };
  const microphone = stream(); const display = stream();
  const calls = []; const contexts = []; const gains = [];
  class Context {
    constructor() { this.state = 'running'; contexts.push(this); }
    createMediaStreamDestination() { return { stream: stream() }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { const node = { gain: { value: 0 }, connect() {}, disconnect() {} }; gains.push(node); return node; }
    async resume() {}
    async close() { this.state = 'closed'; }
  }
  const mediaDevices = {
    getUserMedia() { calls.push('microphone'); return Promise.resolve(microphone); },
    getDisplayMedia() { calls.push('display'); return Promise.resolve(display); },
  };
  return { all, stream, microphone, display, calls, contexts, gains, mediaDevices, AudioContext: Context };
}

test('mixes two inputs once and releases every track and audio context', async () => {
  const f = fixture(); const capture = new DesktopAudioCapture(f);
  const pending = capture.start();
  assert.deepEqual(f.calls, ['display', 'microphone']);
  const output = await pending;
  assert.equal(output.getAudioTracks().length, 1);
  assert.deepEqual(f.gains.map((g) => g.gain.value), [0.5, 0.5]);
  await assert.rejects(capture.start(), /already started/);
  assert.equal(f.calls.length, 2);
  await capture.close(); await capture.close();
  assert.ok(f.all.every((s) => s.getTracks().every((t) => t.readyState === 'ended')));
  assert.equal(f.contexts[0].state, 'closed');
});

test('explicit microphone mode requests no display permission and retains full gain', async () => {
  const f = fixture(); const capture = new DesktopAudioCapture(f);
  await capture.start('microphone');
  assert.deepEqual(f.calls, ['microphone']);
  assert.equal(f.gains[0].gain.value, 1);
  await capture.close();
});

test('missing system audio fails without starting a microphone-only session', async () => {
  const f = fixture(); const silent = f.stream(false);
  f.mediaDevices.getDisplayMedia = async () => silent;
  const capture = new DesktopAudioCapture(f);
  await assert.rejects(capture.start(), /System audio is unavailable/);
  assert.equal(f.contexts.length, 0);
  assert.equal(silent.getTracks()[0].readyState, 'ended');
  assert.equal(f.microphone.getTracks()[0].readyState, 'ended');
});

test('denial closes the other stream even if permission resolves later', async () => {
  const f = fixture(); let resolveMic;
  f.mediaDevices.getDisplayMedia = async () => { throw new Error('Permission denied'); };
  f.mediaDevices.getUserMedia = () => new Promise((resolve) => { resolveMic = resolve; });
  const capture = new DesktopAudioCapture(f);
  await assert.rejects(capture.start(), /Permission denied/);
  resolveMic(f.microphone);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.microphone.getTracks()[0].readyState, 'ended');
});

test('stop during permission request closes both late streams without a context', async () => {
  const f = fixture(); let resolveDisplay;
  f.mediaDevices.getDisplayMedia = () => new Promise((resolve) => { resolveDisplay = resolve; });
  const capture = new DesktopAudioCapture(f);
  const pending = capture.start();
  await capture.close(); resolveDisplay(f.display);
  await assert.rejects(pending, /stopped/);
  assert.equal(f.contexts.length, 0);
  assert.equal(f.microphone.getTracks()[0].readyState, 'ended');
  assert.equal(f.display.getTracks()[0].readyState, 'ended');
});

test('system track ending closes all capture and notifies UI once', async () => {
  const f = fixture(); let ended = 0;
  const capture = new DesktopAudioCapture({ ...f, onEnded: () => { ended += 1; } });
  await capture.start();
  f.display.getTracks()[0].ended(); f.microphone.getTracks()[0].ended();
  assert.equal(ended, 1);
  assert.equal(f.contexts[0].state, 'closed');
  assert.ok(f.all.every((s) => s.getTracks().every((t) => t.readyState === 'ended')));
});

test('display handler authorizes only user-initiated trusted bar capture and rechecks after lookup', async () => {
  const frame = { url: 'file:///app/index.html' };
  const win = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  let current = win; let handler; let lookups = 0;
  const request = { frame, userGesture: true, audioRequested: true };
  const sources = [{ id: 'screen:1' }];
  installDisplayCapture({
    session: { setDisplayMediaRequestHandler(fn) { handler = fn; } },
    desktopCapturer: { async getSources() { lookups += 1; return sources; } },
    getBarWindow: () => current, indexPath: '/app/index.html',
  });
  const invoke = (value) => new Promise((resolve) => { handler(value, resolve); });
  assert.deepEqual(await invoke({ ...request, userGesture: false }), null);
  assert.deepEqual(await invoke({ ...request, frame: { url: frame.url } }), null);
  assert.deepEqual(await invoke({ ...request, audioRequested: false }), null);
  assert.equal(lookups, 0);
  assert.deepEqual(await invoke(request), { video: sources[0], audio: 'loopback' });
  const pending = invoke(request); current = null;
  assert.deepEqual(await pending, null);
});

test('capture settings default to both inputs and preserve explicit microphone mode', () => {
  assert.equal(normalizeConfig().audioCaptureMode, 'microphone_system');
  assert.equal(normalizeConfig({ audioCaptureMode: 'microphone' }).audioCaptureMode, 'microphone');
  assert.equal(normalizeConfig({ audioCaptureMode: 'invalid' }).audioCaptureMode, 'microphone_system');
});

for (const failure of ['empty', 'lookup-error']) {
  test(`display capture denies ${failure} with Electron's null response once`, async () => {
    const frame = { url: 'file:///app/index.html' };
    const win = { isDestroyed: () => false, webContents: { mainFrame: frame } };
    let handler; const responses = [];
    installDisplayCapture({
      session: { setDisplayMediaRequestHandler(fn) { handler = fn; } },
      desktopCapturer: { async getSources() {
        if (failure === 'lookup-error') throw new Error('Capture unavailable');
        return [];
      } },
      getBarWindow: () => win, indexPath: '/app/index.html',
    });
    await handler({ frame, userGesture: true, audioRequested: true }, (streams) => {
      responses.push(streams);
      // Electron44 rejects an empty object as invalid capture constraints.
      assert.equal(streams, null);
    });
    assert.deepEqual(responses, [null]);
  });
}

test('display capture never retries a consumed callback after a delivery error', async () => {
  const frame = { url: 'file:///app/index.html' };
  const win = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  let handler; let calls = 0;
  installDisplayCapture({
    session: { setDisplayMediaRequestHandler(fn) { handler = fn; } },
    desktopCapturer: { async getSources() { return [{ id: 'screen:1' }]; } },
    getBarWindow: () => win, indexPath: '/app/index.html',
  });
  await assert.rejects(handler({ frame, userGesture: true, audioRequested: true }, () => {
    calls += 1;
    throw new Error('Frame destroyed during delivery');
  }), /Frame destroyed/);
  assert.equal(calls, 1);
});
