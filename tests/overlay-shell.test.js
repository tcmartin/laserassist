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
  assert.match(html, /queueTranscriptPanelRefresh/);
  assert.match(html, /queueAutoInsight/);
  assert.match(html, /const suffix = liveMode \? 'live'/);
  assert.match(html, /grid-template-columns:\s*minmax\(240px,\s*1fr\)\s*auto/);
  assert.match(html, /\.controls\s*\{[\s\S]*flex-wrap:\s*wrap/);

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
  assert.match(mainJs, /minWidth:\s*720/);
  assert.match(mainJs, /maxHeight:\s*220/);
  assert.match(mainJs, /setContentProtection\(true\)/);
  assert.match(mainJs, /existing\.loadURL\(/);
  assert.match(mainJs, /workArea\.y \+ 148/);
  assert.match(mainJs, /setAlwaysOnTop\(isPinned, 'pop-up-menu'\)/);
  assert.match(mainJs, /setWindowOpenHandler\(\(\) => \(\{/);
  assert.match(mainJs, /overrideBrowserWindowOptions/);
  assert.match(mainJs, /did-create-window/);
  assert.match(mainJs, /ready-to-show/);
  assert.match(mainJs, /2fa_required/);
  assert.match(mainJs, /list\.push\(`\$\{base\}\/oauth-bridge`\)[\s\S]*list\.push\(`\$\{base\}\/login`\)/);

  // Guard against reintroducing local-model runtime pathways.
  assert.equal(mainJs.includes('llm-worker'), false);
  assert.equal(mainJs.includes('model-downloader'), false);
  assert.equal(mainJs.includes('asr_server.py'), false);
  assert.equal(mainJs.includes('Transformers.js'), false);
});

test('OAuth bridge persists successful auth token for Electron capture', () => {
  const bridgeJs = fs.readFileSync(
    path.join(__dirname, '..', '..', 'laserreach_front', 'pages', 'oauth-bridge.js'),
    'utf8',
  );
  assert.match(bridgeJs, /localStorage\.setItem\('jwt', accessToken\)/);
  assert.match(bridgeJs, /window\.opener\.postMessage/);
});
