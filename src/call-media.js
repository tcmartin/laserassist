(function (root) {
  'use strict';

  class CallMedia {
    constructor({ platform = root, onCandidate = () => {}, onState = () => {},
      onRemoteStream = () => {}, onMixedStream = () => {}, playback = null } = {}) {
      this.platform = platform;
      this.onCandidate = onCandidate;
      this.onState = onState;
      this.onRemoteStream = onRemoteStream;
      this.onMixedStream = onMixedStream;
      this.closed = false;
      this.peer = null;
      this.context = null;
      this.localStream = null;
      this.remoteStream = null;
      this.nodes = [];
      this.candidates = [];
      this.remoteTrackIds = new Set();
      this.events = Promise.resolve();
      this.playback = playback;
    }

    _current(peer) {
      if (this.closed || this.peer !== peer) throw new Error('call_media_closed');
    }

    _mix(stream) {
      const source = this.context.createMediaStreamSource(stream);
      const gain = this.context.createGain();
      gain.gain.value = 0.5;
      source.connect(gain);
      gain.connect(this.mix);
      this.nodes.push(source, gain);
    }

    async start(localStream, { iceServers = [] } = {}) {
      if (this.closed || this.peer) throw new Error('call_media_already_started');
      if (!localStream || !localStream.getAudioTracks().length || localStream.getVideoTracks().length) {
        throw new Error('call_audio_stream_required');
      }
      this.localStream = localStream;
      try {
        const peer = this.peer = new this.platform.RTCPeerConnection({ iceServers });
        this.context = new this.platform.AudioContext();
        this.mix = this.context.createMediaStreamDestination();
        this.remoteStream = new this.platform.MediaStream();
        this.playback = this.playback || new this.platform.Audio();
        this._mix(localStream);
        for (const track of localStream.getAudioTracks()) peer.addTrack(track, localStream);
        peer.onicecandidate = ({ candidate }) => {
          if (this.closed || this.peer !== peer) return;
          if (!candidate) { this.onCandidate(null); return; }
          const value = candidate.toJSON();
          const wire = { candidate: value.candidate };
          for (const key of ['sdpMid', 'sdpMLineIndex']) {
            if (value[key] !== null && value[key] !== undefined) wire[key] = value[key];
          }
          this.onCandidate(wire);
        };
        peer.onconnectionstatechange = () => {
          if (!this.closed && this.peer === peer) this.onState(peer.connectionState);
        };
        peer.ontrack = ({ track }) => {
          if (this.closed || this.peer !== peer || track.kind !== 'audio' || this.remoteTrackIds.has(track.id)) return;
          this.remoteTrackIds.add(track.id);
          this.remoteStream.addTrack(track);
          this._mix(new this.platform.MediaStream([track]));
          this.playback.srcObject = this.remoteStream;
          Promise.resolve(this.playback.play()).catch(() => {
            if (!this.closed) this.onState('playback_blocked');
          });
          this.onRemoteStream(this.remoteStream);
        };
        await this.context.resume();
        this._current(peer);
        this.onMixedStream(this.mix.stream, this.context.sampleRate);
        const offer = await peer.createOffer();
        this._current(peer);
        await peer.setLocalDescription(offer);
        this._current(peer);
        return { type: 'offer', sdp: peer.localDescription.sdp };
      } catch (error) {
        await this.close();
        throw error;
      }
    }

    receive(event) {
      // Answers and ICE may arrive in separate IPC events. Preserve their order
      // across asynchronous browser operations without poisoning later events.
      const result = this.events.then(() => this._receive(event));
      this.events = result.catch(() => {});
      return result;
    }

    async _receive(event) {
      const peer = this.peer;
      this._current(peer);
      if (!peer) throw new Error('call_media_not_started');
      if (!event || typeof event !== 'object') throw new Error('call_media_invalid_event');
      if (event.jsep) {
        const answer = event.jsep;
        if (answer.type !== 'answer' || typeof answer.sdp !== 'string' || !answer.sdp
          || new TextEncoder().encode(answer.sdp).length > 128 * 1024) {
          throw new Error('call_media_invalid_answer');
        }
        if (peer.remoteDescription?.sdp !== answer.sdp) {
          await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
          this._current(peer);
        }
        for (const candidate of this.candidates.splice(0)) {
          await peer.addIceCandidate(candidate);
          this._current(peer);
        }
      }
      if (event.type === 'candidate') {
        const candidate = event.candidate?.completed ? null : event.candidate;
        if (candidate !== null && (!candidate || typeof candidate !== 'object'
          || typeof candidate.candidate !== 'string' || candidate.candidate.length > 4096)) {
          throw new Error('call_media_invalid_candidate');
        }
        if (peer.remoteDescription) {
          await peer.addIceCandidate(candidate);
          this._current(peer);
        } else {
          if (this.candidates.length >= 128) throw new Error('call_media_candidate_limit');
          this.candidates.push(candidate);
        }
      }
      if (event.state === 'ended' || event.state === 'failed') await this.close();
    }

    async close() {
      if (this.closed) return;
      this.closed = true;
      const peer = this.peer;
      this.peer = null;
      if (peer) {
        peer.onicecandidate = null;
        peer.ontrack = null;
        peer.onconnectionstatechange = null;
        peer.close();
      }
      for (const node of this.nodes) node.disconnect();
      this.nodes = [];
      for (const stream of [this.localStream, this.remoteStream, this.mix?.stream]) {
        if (stream) for (const track of stream.getTracks()) track.stop();
      }
      this.localStream = null;
      this.remoteStream = null;
      if (this.playback) {
        this.playback.pause();
        this.playback.srcObject = null;
      }
      this.candidates = [];
      this.remoteTrackIds.clear();
      if (this.context && this.context.state !== 'closed') await this.context.close();
      this.context = null;
      this.onState('closed');
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { CallMedia };
  else root.CallMedia = CallMedia;
})(typeof globalThis !== 'undefined' ? globalThis : window);
