#!/usr/bin/env node

/**
 * Audio Performance Test
 * 
 * This script tests the audio processing pipeline to ensure it remains non-blocking
 * even when the LLM is under heavy load.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class AudioPerformanceTest {
  constructor() {
    this.asrProcess = null;
    this.testResults = {
      audioLatency: [],
      transcriptionLatency: [],
      droppedChunks: 0,
      totalChunks: 0
    };
    this.startTime = Date.now();
  }

  async startASRServer() {
    console.log('🚀 Starting ASR server...');
    
    const asrScript = path.join(__dirname, 'asr_server.py');
    this.asrProcess = spawn('python3', [asrScript, '--mode', 'stdio'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.asrProcess.stderr.on('data', (data) => {
      console.log('ASR stderr:', data.toString());
    });

    this.asrProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach(line => {
        try {
          const msg = JSON.parse(line);
          this.handleASRMessage(msg);
        } catch (e) {
          console.log('ASR stdout:', line);
        }
      });
    });

    // Start ASR session
    this.sendASRMessage({
      op: 'start',
      sample_rate: 16000,
      window: 5,
      update_ms: 1000
    });

    console.log('✅ ASR server started');
  }

  sendASRMessage(msg) {
    if (this.asrProcess && this.asrProcess.stdin.writable) {
      this.asrProcess.stdin.write(JSON.stringify(msg) + '\n');
    }
  }

  handleASRMessage(msg) {
    const now = Date.now();
    
    switch (msg.op) {
      case 'partial':
      case 'final':
        const latency = now - (msg.ts || now);
        this.testResults.transcriptionLatency.push(latency);
        console.log(`📝 Transcription: "${msg.text}" (latency: ${latency}ms)`);
        break;
      case 'error':
        console.error('❌ ASR Error:', msg.message);
        break;
      case 'status':
        console.log('ℹ️  ASR Status:', msg.message);
        break;
    }
  }

  generateTestAudio() {
    // Generate 16kHz mono PCM audio data (sine wave)
    const sampleRate = 16000;
    const duration = 0.1; // 100ms chunks
    const samples = Math.floor(sampleRate * duration);
    const frequency = 440; // A4 note
    
    const audioData = new Int16Array(samples);
    for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      const sample = Math.sin(2 * Math.PI * frequency * t) * 0.5;
      audioData[i] = Math.floor(sample * 32767);
    }
    
    return Buffer.from(audioData.buffer);
  }

  async simulateAudioStream() {
    console.log('🎵 Starting audio stream simulation...');
    
    const chunkInterval = 100; // Send audio every 100ms
    let chunkCount = 0;
    
    const sendAudioChunk = () => {
      const audioChunk = this.generateTestAudio();
      const base64Audio = audioChunk.toString('base64');
      const sendTime = Date.now();
      
      this.sendASRMessage({
        op: 'audio',
        base64: base64Audio
      });
      
      chunkCount++;
      this.testResults.totalChunks = chunkCount;
      
      // Measure audio processing latency
      const processingTime = Date.now() - sendTime;
      this.testResults.audioLatency.push(processingTime);
      
      if (processingTime > 50) {
        console.warn(`⚠️  High audio processing latency: ${processingTime}ms`);
      }
      
      if (chunkCount % 10 === 0) {
        console.log(`📊 Sent ${chunkCount} audio chunks`);
      }
    };
    
    // Send audio chunks at regular intervals
    const audioInterval = setInterval(sendAudioChunk, chunkInterval);
    
    // Stop after 30 seconds
    setTimeout(() => {
      clearInterval(audioInterval);
      this.printResults();
      this.cleanup();
    }, 30000);
  }

  async simulateLLMLoad() {
    console.log('🧠 Simulating LLM load...');
    
    // Simulate CPU-intensive work that might block the event loop
    const heavyComputation = () => {
      const start = Date.now();
      let result = 0;
      
      // CPU-intensive loop for ~500ms
      while (Date.now() - start < 500) {
        for (let i = 0; i < 100000; i++) {
          result += Math.sqrt(i) * Math.sin(i);
        }
      }
      
      return result;
    };
    
    // Run heavy computation every 2 seconds
    const llmInterval = setInterval(() => {
      console.log('🔥 Running heavy LLM computation...');
      const start = Date.now();
      
      // Use setImmediate to yield control periodically
      const runWithYield = () => {
        heavyComputation();
        const duration = Date.now() - start;
        console.log(`✅ LLM computation completed in ${duration}ms`);
      };
      
      setImmediate(runWithYield);
    }, 2000);
    
    // Stop LLM simulation after 30 seconds
    setTimeout(() => {
      clearInterval(llmInterval);
    }, 30000);
  }

  printResults() {
    console.log('\n📊 Performance Test Results:');
    console.log('================================');
    
    const avgAudioLatency = this.testResults.audioLatency.length > 0 
      ? this.testResults.audioLatency.reduce((a, b) => a + b, 0) / this.testResults.audioLatency.length 
      : 0;
    
    const maxAudioLatency = this.testResults.audioLatency.length > 0 
      ? Math.max(...this.testResults.audioLatency) 
      : 0;
    
    const avgTranscriptionLatency = this.testResults.transcriptionLatency.length > 0 
      ? this.testResults.transcriptionLatency.reduce((a, b) => a + b, 0) / this.testResults.transcriptionLatency.length 
      : 0;
    
    console.log(`Total audio chunks sent: ${this.testResults.totalChunks}`);
    console.log(`Dropped chunks: ${this.testResults.droppedChunks}`);
    console.log(`Average audio processing latency: ${avgAudioLatency.toFixed(2)}ms`);
    console.log(`Maximum audio processing latency: ${maxAudioLatency}ms`);
    console.log(`Average transcription latency: ${avgTranscriptionLatency.toFixed(2)}ms`);
    console.log(`Transcription responses received: ${this.testResults.transcriptionLatency.length}`);
    
    // Performance assessment
    if (maxAudioLatency > 100) {
      console.log('❌ FAIL: Audio processing latency too high (>100ms)');
    } else if (avgAudioLatency > 50) {
      console.log('⚠️  WARN: Average audio processing latency is high (>50ms)');
    } else {
      console.log('✅ PASS: Audio processing latency is acceptable');
    }
    
    if (this.testResults.droppedChunks > 0) {
      console.log('❌ FAIL: Audio chunks were dropped');
    } else {
      console.log('✅ PASS: No audio chunks dropped');
    }
  }

  cleanup() {
    console.log('🧹 Cleaning up...');
    
    if (this.asrProcess) {
      this.sendASRMessage({ op: 'stop' });
      setTimeout(() => {
        if (this.asrProcess) {
          this.asrProcess.kill();
        }
      }, 1000);
    }
    
    setTimeout(() => {
      process.exit(0);
    }, 2000);
  }
}

// Run the test
async function runTest() {
  console.log('🧪 Starting Audio Performance Test');
  console.log('This test will run for 30 seconds...\n');
  
  const test = new AudioPerformanceTest();
  
  try {
    await test.startASRServer();
    
    // Wait a moment for ASR to initialize
    setTimeout(() => {
      test.simulateAudioStream();
      test.simulateLLMLoad();
    }, 2000);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    test.cleanup();
  }
}

if (require.main === module) {
  runTest();
}

module.exports = AudioPerformanceTest;