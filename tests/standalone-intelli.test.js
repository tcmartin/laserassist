const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('standalone Intelli has no desktop dialer surface or calling IPC wiring', () => {
  const index = read('index.html');
  const main = read('main.js');
  const preload = read('preload.js');

  assert.doesNotMatch(index, /dialerBtn|dialerWorkspace|DialerUI|call-media\.js|dialer-ui\.css/);
  assert.doesNotMatch(main, /CallingClient|CallSignaling|callingClient|callSignaling|calling-[a-z]/);
  assert.doesNotMatch(preload, /calling[A-Z]|calling-[a-z]/);
  assert.match(main, /HostedAudioTranscriber/);
  assert.match(preload, /asrStart|asrSendChunkF32|sendAnalysisRequest|sessionStart/);
  assert.match(index, /listenBtn/);
  assert.match(index, /runAutoInsightIfReady/);
});

test('shared calling modules remain available for the website migration only', () => {
  for (const file of ['src/call-media.js', 'src/call-signaling.js', 'src/calling-client.js']) {
    assert.ok(fs.existsSync(path.join(root, file)), file);
  }
});
