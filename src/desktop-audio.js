(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DesktopAudioCapture = factory().DesktopAudioCapture;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  class DesktopAudioCapture {
    constructor({ mediaDevices, AudioContext, onEnded = () => {} } = {}) {
      this.mediaDevices = mediaDevices || navigator.mediaDevices;
      this.AudioContext = AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext;
      this.onEnded = onEnded;
      this.streams = [];
      this.nodes = [];
      this.context = null;
      this.output = null;
      this.closed = false;
      this.started = false;
    }

    start(mode = 'microphone_system') {
      if (this.started || this.closed) return Promise.reject(new Error('Audio capture already started.'));
      this.started = true;
      // Invoke display capture synchronously from the user's Start click.
      // Waiting for microphone permission first can lose user activation.
      const requests = [];
      try {
        if (mode === 'microphone_system') {
          requests.push(this._own(this.mediaDevices.getDisplayMedia({
            audio: true,
            video: { width: 1, height: 1, frameRate: 1 },
          }), 'System audio is unavailable. Enable system audio access or choose Microphone only in Settings.'));
        } else if (mode !== 'microphone') {
          throw new Error('Unknown audio capture mode.');
        }
        requests.push(this._own(this.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        }), 'Microphone audio is unavailable.'));
      } catch (error) {
        // _own stops streams that arrive after this synchronous failure.
        for (const request of requests) void request.catch(() => {});
        void this.close();
        return Promise.reject(error);
      }
      return Promise.all(requests).then(async (streams) => {
        if (this.closed) throw new Error('Audio capture stopped.');
        this.context = new this.AudioContext({ sampleRate: 48000 });
        this.output = this.context.createMediaStreamDestination();
        for (const stream of streams) {
          const source = this.context.createMediaStreamSource(stream);
          const gain = this.context.createGain();
          gain.gain.value = 1 / streams.length;
          source.connect(gain);
          gain.connect(this.output);
          this.nodes.push(source, gain);
        }
        await this.context.resume();
        if (this.closed) throw new Error('Audio capture stopped.');
        return this.output.stream;
      }).catch(async (error) => {
        await this.close();
        throw error;
      });
    }

    async _own(pending, missingAudioMessage) {
      const stream = await pending;
      if (this.closed) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('Audio capture stopped.');
      }
      this.streams.push(stream);
      const tracks = stream.getAudioTracks();
      if (!tracks.length || tracks.every((track) => track.readyState === 'ended')) {
        throw new Error(missingAudioMessage);
      }
      // Keep the display video track alive for platforms that tie audio to
      // its lifetime. It is never connected to ASR or sent over the network.
      stream.getTracks().forEach((track) => track.addEventListener('ended', () => {
        if (this.closed) return;
        void this.close();
        this.onEnded();
      }, { once: true }));
      return stream;
    }

    async close() {
      if (this.closed) return;
      this.closed = true;
      for (const node of this.nodes) { try { node.disconnect(); } catch (_) {} }
      this.nodes = [];
      for (const stream of this.streams) stream.getTracks().forEach((track) => track.stop());
      this.streams = [];
      if (this.output) this.output.stream.getTracks().forEach((track) => track.stop());
      this.output = null;
      const context = this.context;
      this.context = null;
      if (context && context.state !== 'closed') await context.close();
    }
  }
  return { DesktopAudioCapture };
}));
