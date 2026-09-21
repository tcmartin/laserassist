const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const root = path.resolve(__dirname, '..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(fn, label) {
  for (let i = 0; i < 100; i++) { try { const value = await fn(); if (value) return value; } catch (_) {} await delay(100); }
  throw new Error(`Timeout: ${label}`);
}
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url); this.sequence = 0; this.pending = new Map(); this.errors = [];
    this.ready = new Promise((resolve) => this.ws.once('open', resolve));
    this.ws.on('message', (raw) => {
      const message = JSON.parse(raw);
      if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params.exceptionDetails.text);
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }
  async call(method, params = {}) {
    await this.ready; const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  close() { this.ws.close(); }
}

test('actual Electron dialer searches, reviews, edits scripts and clears workspace data', {
  skip: process.env.RUN_INTELLI_DIALER_UI !== '1' && 'set RUN_INTELLI_DIALER_UI=1 for actual Electron UI checks', timeout: 60000,
}, async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-dialer-ui-'));
  const server = http.createServer(); const requests = [];
  const script = { template_id: 'script_discovery', title: 'Discovery conversation', revision: 1, source: 'local_agent',
    opening: 'Hello {{person.full_name}}. Thank you for making time.', questions: ['How does your team follow up today?', 'What would a better handoff look like?'],
    objection_guidance: ['If timing is difficult, ask about the next planning cycle.'], next_step: 'Agree on a short follow-up meeting.' };
  const person = { person_id: 'person_jordan', full_name: 'Jordan Ellis', title: 'Head of Operations', email: 'jordan@example.test', company_name: 'Northstar Supply' };
  const context = { person_id: person.person_id, person, company: { name: 'Northstar Supply' }, context_snapshot_id: 'ctx_fixture',
    pipeline_context: 'Northstar is reviewing its sales handoff process. Jordan wants faster follow-up and clear ownership.',
    phone_candidates: [{ number_id: 'phone_destination', number: '+15555550101', eligible: true }] };
  const call = { call_id: `call_${'a'.repeat(64)}`, session_id: `call_${'a'.repeat(64)}`, state: 'prepared', destination: '+15555550101', caller_number: '+15555550102', context,
    rendered_script: { ...script, opening: 'Hello Jordan Ellis. Thank you for making time.' } };
  server.on('request', async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, 'http://localhost'); requests.push({ path: url.pathname, method: req.method, body: raw && JSON.parse(raw) });
    let result = { success: true };
    if (url.pathname === '/user/me') result = { username: 'synthetic_user' };
    else if (url.pathname === '/me/orgs') result = [{ org_id: 'synthetic_org', name: 'Northstar workspace' }];
    else if (url.pathname === '/api/abm/people') result.people = [person];
    else if (url.pathname.endsWith('/call-context')) result.context = context;
    else if (url.pathname.endsWith('/scripts') && req.method === 'GET') result.scripts = [script];
    else if (url.pathname.endsWith('/scripts/script_discovery') && req.method === 'PUT') { Object.assign(script, JSON.parse(raw)); script.revision++; result.script = script; }
    else if (url.pathname.endsWith('/numbers/options')) result.available = false;
    else if (url.pathname.endsWith('/numbers')) result.numbers = [{ number_id: 'number_local', number: '+15555550102', local_only: true, status: 'active' }];
    else if (url.pathname.endsWith('/calls') && req.method === 'POST') result.call = call;
    else if (url.pathname.includes('reminders')) result.reminders = [];
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const portServer = net.createServer(); await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve));
  const debugPort = portServer.address().port; await new Promise((resolve) => portServer.close(resolve));
  const backendUrl = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ hosted: { backendUrl, frontendUrl: backendUrl, tenantId: 'synthetic_org', jwtToken: 'fixture-token' } }), { mode: 0o600 });
  const env = { ...process.env, INTELLI_CAPTURE_PROTECTION: 'off' }; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.INTELLI_PACKAGED_BIN;
  const child = spawn(packaged || require('electron'), [...(packaged ? [] : [root]), `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, '--disable-gpu'], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (data) => { output += data; }); child.stderr.on('data', (data) => { output += data; });
  let cdp;
  try {
    const target = await until(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((entry) => entry.type === 'page' && entry.url.endsWith('index.html')), 'renderer');
    if (packaged) assert.ok(target.url.includes('/app.asar/index.html'), 'testing the packaged renderer');
    cdp = new Cdp(target.webSocketDebuggerUrl); await cdp.call('Runtime.enable');
    await until(() => cdp.evaluate(`document.getElementById('signinBtn').textContent === 'Signed In'`), 'authenticated UI');
    const evidence = process.env.INTELLI_UI_EVIDENCE_DIR;
    if (evidence) { fs.mkdirSync(evidence, { recursive: true }); const shot = await cdp.call('Page.captureScreenshot'); fs.writeFileSync(path.join(evidence, 'bar-reference.png'), Buffer.from(shot.data, 'base64')); }
    await cdp.evaluate(`document.getElementById('dialerBtn').click()`);
    await until(() => cdp.evaluate(`document.querySelector('#dc-people button')?.textContent.includes('Jordan')`), 'contact results');
    await cdp.evaluate(`document.querySelector('#dc-people button').click()`);
    await until(() => cdp.evaluate(`document.getElementById('dc-person-name').textContent === 'Jordan Ellis'`), 'contact context');
    await cdp.evaluate(`document.getElementById('dc-script').value='script_discovery';document.getElementById('dc-script').dispatchEvent(new Event('change'));document.getElementById('dc-review').click()`);
    await until(() => cdp.evaluate(`!document.getElementById('dc-start').disabled`), 'prepared review');
    assert.ok(await cdp.evaluate(`document.getElementById('dc-preview').textContent.includes('Hello Jordan Ellis')`));
    assert.ok(await cdp.evaluate(`document.getElementById('dc-checkout').disabled`));
    const prepared = requests.find((request) => request.path.endsWith('/calls'));
    assert.equal(prepared.body.context_snapshot_id, 'ctx_fixture'); assert.equal(prepared.body.script_revision, 1); assert.equal(prepared.body.mode, 'local_test');
    if (evidence) { const shot = await cdp.call('Page.captureScreenshot'); fs.writeFileSync(path.join(evidence, 'dialer-review.png'), Buffer.from(shot.data, 'base64')); }
    const overflow = await cdp.evaluate(`document.getElementById('dialerWorkspace').scrollWidth > document.getElementById('dialerWorkspace').clientWidth`);
    assert.equal(overflow, false);
    await cdp.evaluate(`document.getElementById('dc-edit-script').click();document.getElementById('dc-title').value='Focused discovery';document.getElementById('dc-editor').dispatchEvent(new Event('submit',{cancelable:true}))`);
    await until(() => cdp.evaluate(`document.getElementById('dc-status').textContent === 'Script saved.'`), 'script edit');
    assert.ok(await cdp.evaluate(`document.getElementById('dc-start').disabled`));
    assert.equal(requests.find((request) => request.method === 'PUT').body.expected_revision, 1);
    await cdp.evaluate(`window.electronAPI.openOverlayPanel({key:'workspace_test',title:'Previous workspace',text:'Synthetic previous workspace notes'})`);
    await cdp.evaluate(`window.electronAPI.setHostedConfig({tenantId:'second_org'})`);
    await until(() => cdp.evaluate(`document.getElementById('dialerWorkspace').hidden && document.getElementById('dc-person-name').textContent === 'No contact selected'`), 'workspace reset');
    assert.equal((await cdp.evaluate(`window.electronAPI.listOverlayPanels()`)).keys.length, 0);
    assert.deepEqual(cdp.errors, []);
    assert.equal(requests.some((request) => request.path.includes('checkout') || request.path.includes('/media/')), false);
    console.log('Dialer UI: contact/context/review/script edit/workspace reset passed; phone_calls=0 purchases=0');
  } catch (error) { error.message += `; Electron tail: ${output.slice(-700)}`; throw error; }
  finally {
    if (cdp) cdp.close();
    if (child.exitCode === null && !child.signalCode) {
      child.kill('SIGTERM'); await new Promise((resolve) => { const timer = setTimeout(() => child.kill('SIGKILL'), 4000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    }
    await new Promise((resolve) => server.close(resolve)); fs.rmSync(profile, { recursive: true, force: true });
  }
});
