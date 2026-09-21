const test = require('node:test');
const assert = require('node:assert/strict');
const { CallMedia } = require('../src/call-media');

function track(id) { return { id, kind: 'audio', stopped: false, stop() { this.stopped = true; } }; }
class Stream {
  constructor(tracks = []) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
  getVideoTracks() { return []; }
  addTrack(value) { this.tracks.push(value); }
}
class Peer {
  constructor() { this.sent = []; this.ice = []; this.remoteDescription = null; }
  addTrack(value) { this.sent.push(value); }
  async createOffer() { return { type: 'offer', sdp: 'offer-sdp' }; }
  async setLocalDescription(value) { this.localDescription = value; }
  async setRemoteDescription(value) { this.remoteDescription = value; }
  async addIceCandidate(value) { assert.ok(this.remoteDescription); this.ice.push(value); }
  close() { this.closed = true; }
}
function node(extra = {}) {
  return { connections: [], ...extra, connect(other) { this.connections.push(other); }, disconnect() { this.disconnected = true; } };
}
class Audio {
  constructor() { this.state = 'running'; this.sampleRate = 48000; this.sources = []; }
  createMediaStreamDestination() { return node({ stream: new Stream([track('mixed')]) }); }
  createMediaStreamSource(stream) { const out = node({ stream }); this.sources.push(out); return out; }
  createGain() { return node({ gain: { value: 1 } }); }
  async resume() {}
  async close() { this.state = 'closed'; }
}
class Playback {
  async play() { this.played = true; }
  pause() { this.paused = true; }
}
const platform = { RTCPeerConnection: Peer, AudioContext: Audio, MediaStream: Stream, Audio: Playback };

test('only microphone enters peer; remote and microphone enter ASR mix; close releases both', async () => {
  const mic = track('mic');
  const remote = track('remote');
  let mixed;
  let played;
  const media = new CallMedia({ platform, onMixedStream: (value) => { mixed = value; }, onRemoteStream: (value) => { played = value; } });
  assert.deepEqual(await media.start(new Stream([mic])), { type: 'offer', sdp: 'offer-sdp' });
  const peer = media.peer;
  const context = media.context;
  peer.ontrack({ track: remote });
  peer.ontrack({ track: remote });
  assert.deepEqual(peer.sent, [mic]);
  assert.deepEqual(played.getTracks(), [remote]);
  assert.equal(context.sources.length, 2);
  assert.equal(media.playback.srcObject, played);
  assert.equal(media.playback.played, true);
  for (const source of context.sources) {
    assert.equal(source.connections[0].gain.value, 0.5);
    assert.equal(source.connections[0].connections[0].stream, mixed);
  }
  await media.close();
  await media.close();
  assert.ok(mic.stopped && remote.stopped && mixed.getTracks()[0].stopped);
  assert.ok(peer.closed);
  assert.equal(context.state, 'closed');
  assert.ok(context.sources.every((source) => source.disconnected));
  assert.equal(media.playback.srcObject, null);
  assert.equal(media.playback.paused, true);
});

test('early remote ICE waits for answer and preserves end-of-candidates', async () => {
  const emitted = [];
  const media = new CallMedia({ platform, onCandidate: (candidate) => emitted.push(candidate) });
  await media.start(new Stream([track('mic')]));
  media.peer.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: null, usernameFragment: 'browser-ufrag' }) } });
  media.peer.onicecandidate({ candidate: null });
  assert.deepEqual(emitted, [{ candidate: 'candidate:1', sdpMid: '0' }, null]);
  const candidate = { candidate: 'candidate:1', sdpMid: '0' };
  await media.receive({ type: 'candidate', candidate });
  await media.receive({ type: 'candidate', candidate: { completed: true } });
  assert.equal(media.peer.ice.length, 0);
  await media.receive({ type: 'accepted', jsep: { type: 'answer', sdp: 'answer-sdp' } });
  assert.deepEqual(media.peer.ice, [candidate, null]);
  await media.close();
  await assert.rejects(media.receive({ type: 'candidate', candidate }), /call_media_closed/);
});

test('malformed signaling and queue floods never reach the browser peer', async () => {
  const media = new CallMedia({ platform });
  await media.start(new Stream([track('mic')]));
  await assert.rejects(media.receive({ jsep: { type: 'offer', sdp: 'bad' } }), /invalid_answer/);
  await assert.rejects(media.receive({ type: 'candidate', candidate: { candidate: 'x'.repeat(4097) } }), /invalid_candidate/);
  for (let i = 0; i < 128; i++) await media.receive({ type: 'candidate', candidate: null });
  await assert.rejects(media.receive({ type: 'candidate', candidate: null }), /candidate_limit/);
  assert.equal(media.peer.remoteDescription, null);
  assert.deepEqual(media.peer.ice, []);
  await media.receive({ state: 'ended' });
  assert.equal(media.closed, true);
});

test('closing during offer creation prevents a late offer and stops microphone', async () => {
  let finish;
  class SlowPeer extends Peer { createOffer() { return new Promise((resolve) => { finish = resolve; }); } }
  const mic = track('mic');
  const media = new CallMedia({ platform: { ...platform, RTCPeerConnection: SlowPeer } });
  const starting = media.start(new Stream([mic]));
  await new Promise(setImmediate);
  const peer = media.peer;
  await media.close();
  finish({ type: 'offer', sdp: 'late' });
  await assert.rejects(starting, /call_media_closed/);
  assert.equal(peer.localDescription, undefined);
  assert.ok(mic.stopped && peer.closed);
});
