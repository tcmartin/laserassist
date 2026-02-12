const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readFile(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

test('Overlay renderer uses compact control bar + dynamic panels and no manual token field', () => {
  const html = readFile('index.html');

  assert.match(html, /class="bar-shell"/);
  assert.match(html, /id="signinBtn"/);
  assert.match(html, /id="meetingPill"/);
  assert.match(html, /id="tenantSelect"/);
  assert.match(html, /id="refreshOrgsBtn"/);
  assert.match(html, /id="frontendInput"/);
  assert.match(html, /openOverlayPanel/);

  // Ensure users are not asked to paste raw JWT tokens in the UI.
  assert.equal(/id="jwt/i.test(html), false);
  assert.equal(/name="jwt/i.test(html), false);
  assert.equal(/placeholder=".*token/i.test(html), false);
});

test('Main process contract is hosted-only with auth and panel IPC wiring', () => {
  const mainJs = readFile('main.js');

  assert.match(mainJs, /HostedApiClient/);
  assert.match(mainJs, /HostedAudioTranscriber/);
  assert.match(mainJs, /auth-open-login/);
  assert.match(mainJs, /auth-list-orgs/);
  assert.match(mainJs, /deriveFrontendBases/);
  assert.match(mainJs, /:3100/);
  assert.match(mainJs, /overlay-open-panel/);
  assert.match(mainJs, /hosted-get-reminders/);

  // Guard against reintroducing local-model runtime pathways.
  assert.equal(mainJs.includes('llm-worker'), false);
  assert.equal(mainJs.includes('model-downloader'), false);
  assert.equal(mainJs.includes('asr_server.py'), false);
  assert.equal(mainJs.includes('Transformers.js'), false);
});
