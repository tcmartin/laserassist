const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

test('generated voice crosses real Electron WebRTC in both directions and reaches ASR mix', {
  skip: process.env.RUN_INTELLI_MEDIA_E2E !== '1' && 'set RUN_INTELLI_MEDIA_E2E=1 for local generated-voice WebRTC test',
  timeout: 40000,
}, async () => {
  const root = path.resolve(__dirname, '..');
  const wav = process.env.INTELLI_TEST_VOICE || '/Users/trevormartin/Projects/laserreach/output/calling-validation-20260920/buyer.wav';
  assert.ok(fs.existsSync(wav), 'generated voice fixture exists');
  const audio = fs.readFileSync(wav).toString('base64');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-media-e2e-'));
  const html = path.join(tmp, 'media.html');
  const entry = path.join(tmp, 'main.cjs');
  const scenario = async (audioBase64) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const context = new AudioContext();
    const buffer = await context.decodeAudioData(Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0)).buffer);
    const sources = [];
    function voice() {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const destination = context.createMediaStreamDestination();
      source.connect(destination);
      source.start();
      sources.push({ source, destination });
      return destination.stream;
    }
    const other = new RTCPeerConnection({ iceServers: [] });
    const waiting = [];
    let received = false;
    let remote = false;
    let mixed;
    const playback = new Audio();
    playback.volume = 0;
    const media = new CallMedia({
      playback,
      onCandidate(candidate) {
        if (other.remoteDescription) other.addIceCandidate(candidate).catch(() => {});
        else waiting.push(candidate);
      },
      onRemoteStream() { remote = true; },
      onMixedStream(stream) { mixed = stream; },
    });
    other.ontrack = () => { received = true; };
    const signalErrors = [];
    other.onicecandidate = ({ candidate }) => {
      media.receive({ type: 'candidate', candidate: candidate ? candidate.toJSON() : null }).catch((error) => signalErrors.push(error.message));
    };
    let result;
    try {
      await context.resume();
      const local = voice();
      const peerVoice = voice();
      other.addTrack(peerVoice.getAudioTracks()[0], peerVoice);
      const offer = await media.start(local);
      await other.setRemoteDescription(offer);
      for (const candidate of waiting.splice(0)) await other.addIceCandidate(candidate);
      await other.setLocalDescription(await other.createAnswer());
      await media.receive({ type: 'accepted', jsep: { type: 'answer', sdp: other.localDescription.sdp } });
      const analyser = context.createAnalyser();
      const mixedSource = context.createMediaStreamSource(mixed);
      mixedSource.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let energy = 0;
      let bytesIn = 0;
      let bytesOther = 0;
      for (let i = 0; i < 100; i++) {
        await wait(100);
        analyser.getFloatTimeDomainData(samples);
        energy = Math.max(energy, samples.reduce((sum, value) => sum + value * value, 0));
        const stats = await media.peer.getStats();
        const otherStats = await other.getStats();
        stats.forEach((stat) => { if (stat.type === 'inbound-rtp' && stat.kind === 'audio') bytesIn = stat.bytesReceived; });
        otherStats.forEach((stat) => { if (stat.type === 'inbound-rtp' && stat.kind === 'audio') bytesOther = stat.bytesReceived; });
        if (received && remote && bytesIn > 100 && bytesOther > 100 && energy > 0.001) break;
      }
      async function peakEnergy() {
        await wait(300);
        let peak = 0;
        for (let i = 0; i < 20; i++) {
          await wait(50);
          analyser.getFloatTimeDomainData(samples);
          peak = Math.max(peak, samples.reduce((sum, value) => sum + value * value, 0));
        }
        return peak;
      }
      local.getAudioTracks()[0].enabled = false;
      const remoteOnlyEnergy = await peakEnergy();
      peerVoice.getAudioTracks()[0].enabled = false;
      // WebRTC may drain buffered RTP after the remote track is disabled.
      // Require a full second of sustained silence within a bounded window,
      // instead of treating the first buffered sample as a permanent failure.
      const muteStarted = performance.now();
      const quietWindow = [];
      let mutedEnergy = Infinity;
      while (performance.now() - muteStarted < 5000) {
        await wait(50);
        analyser.getFloatTimeDomainData(samples);
        quietWindow.push(samples.reduce((sum, value) => sum + value * value, 0));
        if (quietWindow.length > 20) quietWindow.shift();
        mutedEnergy = Math.max(...quietWindow);
        if (quietWindow.length === 20 && mutedEnergy < 0.001) break;
      }
      const muteSettledMs = Math.round(performance.now() - muteStarted);
      local.getAudioTracks()[0].enabled = true;
      const localOnlyEnergy = await peakEnergy();
      mixedSource.disconnect();
      result = { received, remote, bytesIn, bytesOther, mixedEnergy: energy, signalErrors,
        remoteOnlyEnergy, mutedEnergy, mutedSamples: quietWindow.length, muteSettledMs, localOnlyEnergy,
        outboundTracks: media.peer.getSenders().filter((sender) => sender.track).length };
    } finally {
      other.onicecandidate = null;
      other.close();
      await media.close();
      for (const item of sources) {
        item.source.stop();
        item.source.disconnect();
        item.destination.stream.getTracks().forEach((track) => track.stop());
      }
      await context.close();
    }
    return { ...result, mediaClosed: media.closed, tracksEnded: sources.every((item) => item.destination.stream.getTracks().every((track) => track.readyState === 'ended')) };
  };
  fs.writeFileSync(html, `<html><body><script src="${pathToFileURL(path.join(root, 'src/call-media.js')).href}"></script></body></html>`);
  fs.writeFileSync(entry, `const {app,BrowserWindow}=require('electron');
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.setPath('userData',${JSON.stringify(path.join(tmp, 'profile'))});
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true}});
try{await win.loadFile(${JSON.stringify(html)});const result=await win.webContents.executeJavaScript(${JSON.stringify(`(${scenario.toString()})(${JSON.stringify(audio)})`)});console.log('MEDIA_RESULT:'+JSON.stringify(result));app.exit(0);}
catch(error){console.error(error.message);app.exit(1);}});`);
  let child;
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(require('electron'), [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('media_e2e_timeout')); }, 30000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); resolve(code); });
    });
    assert.equal(exitCode, 0, output.slice(-3000));
    const line = output.split('\n').find((value) => value.startsWith('MEDIA_RESULT:'));
    assert.ok(line, output.slice(-1000));
    const result = JSON.parse(line.slice('MEDIA_RESULT:'.length));
    console.log(`Local generated-voice media: ${JSON.stringify(result)}; provider_calls=0`);
    assert.ok(result.received && result.remote);
    assert.ok(result.bytesIn > 100 && result.bytesOther > 100);
    assert.ok(result.mixedEnergy > 0.001);
    assert.ok(result.remoteOnlyEnergy > 0.001, 'received voice reaches transcription without microphone');
    assert.ok(result.localOnlyEnergy > 0.001, 'microphone voice reaches transcription without remote voice');
    assert.ok(result.mutedEnergy < 0.001, 'muting both paths silences transcription');
    assert.equal(result.mutedSamples, 20, 'silence persists for the complete sampling window');
    assert.deepEqual(result.signalErrors, []);
    assert.equal(result.outboundTracks, 1);
    assert.ok(result.mediaClosed && result.tracksEnded);
  } finally {
    if (child && child.exitCode === null && !child.signalCode) {
      child.kill('SIGKILL');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
