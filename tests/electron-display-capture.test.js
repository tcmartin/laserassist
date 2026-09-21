const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Exercise Electron's real one-shot callback and Chromium's display request.
// Source discovery is deliberately empty/failing; no microphone or screen is captured.
test('Electron rejects unavailable display capture without callback errors', { timeout: 20000 }, async () => {
  const binary = require('electron');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-capture-denial-'));
  const handlerPath = path.resolve(__dirname, '../src/display-capture.js');
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Capture denial regression</title>');
  fs.writeFileSync(path.join(dir, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    const { installDisplayCapture } = require(${JSON.stringify(handlerPath)});
    process.on('unhandledRejection', error => { console.error(error); app.exit(1); });
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ show: false });
      const indexPath = ${JSON.stringify(path.join(dir, 'index.html'))};
      await win.loadFile(indexPath);
      for (const failure of ['empty', 'lookup-error']) {
        let lookups = 0;
        installDisplayCapture({ session: win.webContents.session,
          desktopCapturer: { async getSources() {
            lookups++;
            if (failure === 'lookup-error') throw new Error('Unavailable');
            return [];
          } }, getBarWindow: () => win, indexPath });
        const outcome = await win.webContents.executeJavaScript(
          "navigator.mediaDevices.getDisplayMedia({video:true,audio:true}).then(s => { s.getTracks().forEach(t=>t.stop()); return 'unexpected-capture'; }, e => e.name)", true);
        if (outcome !== 'AbortError' || lookups !== 1) throw new Error(JSON.stringify({failure,outcome,lookups}));
      }
      console.log('CAPTURE_DENIAL_VERIFIED');
      app.quit();
    }).catch(error => { console.error(error); app.exit(1); });
  `);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(binary, [path.join(dir, 'main.cjs'), '--headless', '--disable-gpu', `--user-data-dir=${path.join(dir, 'profile')}`], { env });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(code, 0, output);
    assert.match(output, /CAPTURE_DENIAL_VERIFIED/);
    assert.doesNotMatch(output, /UnhandledPromiseRejection|One-time callback|no video stream was provided/);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
