function clampFloatToInt16(v) {
  if (!Number.isFinite(v)) return 0;
  const clamped = Math.max(-1, Math.min(1, v));
  return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
}

function float32ToPcm16Buffer(float32Array) {
  const out = Buffer.alloc(float32Array.length * 2);
  for (let i = 0; i < float32Array.length; i += 1) {
    out.writeInt16LE(clampFloatToInt16(float32Array[i]), i * 2);
  }
  return out;
}

function buildWavBufferFromPcm16(pcmBuffer, sampleRate = 16000, channels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(buffer, 44);

  return buffer;
}

function resampleTo16k(float32Array, srcRate, state = { phase: 0 }) {
  const sourceRate = Number(srcRate) || 16000;
  if (sourceRate === 16000) {
    return { data: float32Array, phase: 0 };
  }

  const step = sourceRate / 16000;
  if (!Number.isFinite(step) || step <= 0) {
    return { data: float32Array, phase: 0 };
  }

  const src = float32Array;
  const srcLen = src.length;
  let phase = Number(state.phase) || 0;
  const outLen = Math.floor((srcLen - phase) / step);
  if (outLen <= 0) {
    return { data: new Float32Array(0), phase: phase + srcLen };
  }

  const out = new Float32Array(outLen);
  let pos = phase;
  for (let i = 0; i < outLen; i += 1) {
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const i1 = i0 + 1;
    const s0 = i0 < srcLen ? src[i0] : 0;
    const s1 = i1 < srcLen ? src[i1] : s0;
    out[i] = s0 + (s1 - s0) * frac;
    pos += step;
  }

  const nextPhase = Math.max(0, pos - srcLen);
  return { data: out, phase: nextPhase };
}

class HostedAudioTranscriber {
  constructor({
    transcribeFn,
    startStreamFn,
    sendPcmChunkFn,
    stopStreamFn,
    onTranscript,
    onStatus,
    onError,
    flushIntervalMs = 1200,
    minBytes = 8000,
  } = {}) {
    const hasStreaming = typeof startStreamFn === 'function' && typeof sendPcmChunkFn === 'function' && typeof stopStreamFn === 'function';
    if (!hasStreaming && typeof transcribeFn !== 'function') {
      throw new Error('HostedAudioTranscriber requires streaming callbacks or transcribeFn');
    }
    this.transcribeFn = transcribeFn;
    this.startStreamFn = startStreamFn;
    this.sendPcmChunkFn = sendPcmChunkFn;
    this.stopStreamFn = stopStreamFn;
    this.streaming = hasStreaming;
    this.onTranscript = onTranscript || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});
    this.flushIntervalMs = Math.max(300, Number(flushIntervalMs) || 1200);
    this.minBytes = Math.max(1600, Number(minBytes) || 8000);

    this.active = false;
    this.streamReady = false;
    this.streamStartPromise = null;
    this.timer = null;
    this.sampleRate = 16000;
    this.phase = 0;
    this.chunks = [];
    this.bytes = 0;
    this.inFlight = false;
    this.sendQueue = Promise.resolve();
  }

  start({ sampleRate = 16000, flushIntervalMs } = {}) {
    this.active = true;
    this.streamReady = !this.streaming;
    this.streamStartPromise = null;
    this.sampleRate = Math.max(8000, Math.min(192000, Number(sampleRate) || 16000));
    this.phase = 0;
    this.chunks = [];
    this.bytes = 0;
    if (flushIntervalMs) {
      this.flushIntervalMs = Math.max(300, Number(flushIntervalMs));
    }

    this._startTimer();
    if (this.streaming && this.startStreamFn) {
      const opts = {
        encoding: 'linear16',
        sampleRate: 16000,
        channels: 1,
        model: 'nova-3',
        language: 'en-US',
        interimResults: true,
        punctuate: true,
        smartFormat: true,
      };
      this.streamStartPromise = Promise.resolve(this.startStreamFn(opts))
        .then(() => {
          this.streamReady = true;
          // Push any buffered audio accumulated during stream startup.
          return this.flush(false);
        })
        .catch((err) => {
          this.streamReady = false;
          this.onError({ op: 'error', message: `ASR stream start failure: ${String(err.message || err)}` });
        });
    }
    this.onStatus({ op: 'status', message: 'Hosted ASR started' });
  }

  async stop() {
    this.active = false;
    this._stopTimer();
    await this.flush(true);
    try {
      if (this.streamStartPromise) {
        await this.streamStartPromise;
      }
      await this.sendQueue;
    } catch (_) {
      // no-op
    }
    if (this.streaming && this.stopStreamFn) {
      try {
        await this.stopStreamFn();
      } catch (err) {
        this.onError({ op: 'error', message: `ASR stream stop failure: ${String(err.message || err)}` });
      }
    }
  }

  addFloat32Chunk(float32Array) {
    if (!this.active || !float32Array) return;

    try {
      const src = float32Array instanceof Float32Array ? float32Array : new Float32Array(float32Array);
      const { data, phase } = resampleTo16k(src, this.sampleRate, { phase: this.phase });
      this.phase = phase;
      if (!data.length) return;

      const pcm = float32ToPcm16Buffer(data);
      if (!pcm.length) return;

      this.chunks.push(pcm);
      this.bytes += pcm.length;
      if (this.bytes >= this.minBytes) {
        this.flush(false);
      }
    } catch (err) {
      this.onError({ op: 'error', message: `ASR chunk failure: ${String(err.message || err)}` });
    }
  }

  async flush(force = false) {
    if (!this.chunks.length) return;
    if (this.streaming && !this.streamReady) return;
    if (!force && this.bytes < this.minBytes) return;

    const pcm = Buffer.concat(this.chunks);
    this.chunks = [];
    this.bytes = 0;

    const sendWork = async () => {
      try {
        if (this.streaming && this.sendPcmChunkFn) {
          await this.sendPcmChunkFn(pcm);
          return;
        }
        const wav = buildWavBufferFromPcm16(pcm, 16000, 1, 16);
        const out = await this.transcribeFn(wav);
        const transcript = String(out?.transcript || '').trim();
        if (transcript) {
          this.onTranscript({ op: 'transcript', text: transcript });
        }
      } catch (err) {
        this.onError({ op: 'error', message: `ASR transcribe failure: ${String(err.message || err)}` });
      }
    };
    this.sendQueue = this.sendQueue.then(sendWork).catch(() => {});
    await this.sendQueue;
  }

  _startTimer() {
    this._stopTimer();
    this.timer = setInterval(() => {
      this.flush(false);
    }, this.flushIntervalMs);
  }

  _stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

module.exports = {
  clampFloatToInt16,
  float32ToPcm16Buffer,
  buildWavBufferFromPcm16,
  resampleTo16k,
  HostedAudioTranscriber,
};
