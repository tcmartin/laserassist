/**
 * AudioWorklet processor for efficient real-time audio capture
 * Replaces the deprecated createScriptProcessor with modern AudioWorklet API
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.sampleBuffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
    this.totalSamples = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    
    if (input.length > 0) {
      const inputChannel = input[0];
      
      // Process each sample
      for (let i = 0; i < inputChannel.length; i++) {
        this.sampleBuffer[this.bufferIndex] = inputChannel[i];
        this.bufferIndex++;
        this.totalSamples++;
        
        // When buffer is full, send it to main thread
        if (this.bufferIndex >= this.bufferSize) {
          // Transfer underlying ArrayBuffer to avoid copying
          const transferable = this.sampleBuffer.buffer;
          this.port.postMessage({
            type: 'audioData',
            buffer: transferable,
            length: this.sampleBuffer.length,
            sampleCount: this.totalSamples
          }, [transferable]);

          // Allocate a new buffer after transfer (old one is neutered)
          this.sampleBuffer = new Float32Array(this.bufferSize);
          this.bufferIndex = 0;
        }
      }
    }
    
    return true; // Keep processor alive
  }
}

registerProcessor('audio-processor', AudioProcessor);
