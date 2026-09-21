const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const appRoot = path.resolve(__dirname, '..');

function electronBinary() {
  if (process.env.INTELLI_ELECTRON_BIN && fs.existsSync(process.env.INTELLI_ELECTRON_BIN)) {
    return process.env.INTELLI_ELECTRON_BIN;
  }

  try {
    const packageRoot = path.dirname(require.resolve('electron'));
    const candidates = process.platform === 'darwin'
      ? [path.join(packageRoot, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')]
      : process.platform === 'win32'
        ? [path.join(packageRoot, 'dist', 'electron.exe')]
        : [path.join(packageRoot, 'dist', 'electron')];
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  } catch (_) {
    return null;
  }
}

const binary = electronBinary();

function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once('exit', done);
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      done();
    }, timeoutMs);
  });
}

test('Electron packaging uses hosted runtime and no implicit install', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts.start, /^electron \. /);
  assert.equal(packageJson.scripts.build, 'electron-builder --publish=never');
  assert.equal(packageJson.scripts['build-dmg'], 'electron-builder --mac dmg --publish=never');
  assert.ok(packageJson.build.files.includes('!models/**/*'));
  assert.ok(packageJson.build.files.includes('!llm-worker*.js'));
  assert.ok(packageJson.build.files.includes('!mcp-*.js'));
  assert.ok(packageJson.build.files.includes('!*.md'));
  assert.ok(packageJson.build.files.includes('!*.bak'));
  assert.ok(packageJson.build.files.includes('!.kiro/**/*'));
  assert.ok(packageJson.build.files.includes('!stream/**/*'));
  assert.ok(packageJson.build.files.includes('!tests/**/*'));
});

test('Electron hosted runtime reaches renderer startup', { skip: !binary ? 'Electron dependency is not installed in this checkout' : false }, async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laserreach-intelli-startup-'));
  const child = spawn(binary, [appRoot, '--headless', '--disable-gpu', `--user-data-dir=${userDataDir}`], {
    cwd: appRoot,
    env: {
      ...process.env,
      INTELLI_CAPTURE_PROTECTION: 'off',
      INTELLI_STARTUP_SMOKE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new Error(`Electron startup timed out. Output: ${output.slice(-2000)}`)), 15000);
      const readyTimer = setInterval(() => {
        if (output.includes('[intelli] startup smoke ready')) {
          clearInterval(readyTimer);
          clearTimeout(timer);
          finish();
        }
      }, 50);
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(readyTimer);
        if (error) reject(error);
        else resolve();
      };
      child.once('error', finish);
      child.once('exit', (code, signal) => {
        if (settled) return;
        if (code !== null && code !== 0) {
          finish(new Error(`Electron exited with code ${code} (${signal || 'no signal'}). Output: ${output.slice(-2000)}`));
          return;
        }
        finish();
      });
    });
    assert.match(output, /\[intelli\] startup smoke ready/);
  } finally {
    if (child.exitCode === null && !child.signalCode) child.kill('SIGTERM');
    await waitForExit(child);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
