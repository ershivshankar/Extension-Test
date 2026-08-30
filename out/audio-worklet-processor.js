// ULTIMATE AUDIO WORKLET PROCESSOR
// This runs in a separate thread for MAXIMUM performance - better than ParakeetAI

class UltimateAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // Processing parameters
    this.chunkSize = 4096;
    this.buffer = new Float32Array(this.chunkSize);
    this.bufferIndex = 0;
    
    // Voice Activity Detection (VAD) parameters
    this.vadWindowSize = 1024;
    this.vadBuffer = new Float32Array(this.vadWindowSize);
    this.vadIndex = 0;
    this.voiceThreshold = 0.02;
    this.noiseFloor = 0.005;
    
    // Noise reduction parameters
    this.noiseGateThreshold = 0.01;
    this.consecutiveVoiceFrames = 0;
    this.requiredVoiceFrames = 3;
    this.silenceFrames = 0;
    this.maxSilenceFrames = 10;
    
    // Audio enhancement
    this.dcBlocker = 0;
    this.dcBlockerCoeff = 0.995;
    
    // Frequency analysis
    this.sampleRate = 44100; // Will be updated
    this.frameCount = 0;
    
    console.log('🎵 Ultimate AudioWorklet Processor initialized');
  }

  static get parameterDescriptors() {
    return [
      {
        name: 'noiseGate',
        defaultValue: 0.01,
        minValue: 0,
        maxValue: 0.1
      },
      {
        name: 'voiceThreshold',
        defaultValue: 0.02,
        minValue: 0,
        maxValue: 0.1
      }
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    
    // Update sample rate
    if (this.frameCount === 0) {
      this.sampleRate = sampleRate;
    }
    this.frameCount++;

    if (input && input[0] && input[0].length > 0) {
      const inputChannel = input[0];
      const outputChannel = output && output[0] ? output[0] : null;
      
      // Process each sample
      for (let i = 0; i < inputChannel.length; i++) {
        let sample = inputChannel[i];
        
        // 1. DC Blocking Filter (removes DC offset)
        const dcBlocked = sample - this.dcBlocker;
        this.dcBlocker = sample * (1 - this.dcBlockerCoeff) + this.dcBlocker * this.dcBlockerCoeff;
        sample = dcBlocked;
        
        // 2. Noise Gate (removes low-level noise)
        const amplitude = Math.abs(sample);
        if (amplitude < this.noiseGateThreshold) {
          sample = 0;
        }
        
        // 3. Add to VAD buffer for voice activity detection
        this.vadBuffer[this.vadIndex] = amplitude;
        this.vadIndex = (this.vadIndex + 1) % this.vadWindowSize;
        
        // 4. Add to processing buffer
        this.buffer[this.bufferIndex] = sample;
        this.bufferIndex++;
        
        // 5. Copy to output (if available)
        if (outputChannel) {
          outputChannel[i] = sample;
        }
        
        // 6. Send chunk when buffer is full
        if (this.bufferIndex >= this.chunkSize) {
          this.processAndSendChunk();
          this.bufferIndex = 0;
        }
      }
    }

    return true; // Keep processor alive
  }

  processAndSendChunk() {
    // Calculate voice activity metrics
    const metrics = this.calculateVoiceMetrics();
    
    // Determine if this chunk contains voice
    const hasVoice = this.detectVoiceActivity(metrics);
    
    if (hasVoice) {
      // Apply additional enhancement for voice chunks
      const enhancedBuffer = this.enhanceVoiceChunk(this.buffer);
      
      // Send high-quality audio chunk for transcription
      this.port.postMessage({
        data: new Float32Array(enhancedBuffer),
        timestamp: currentTime * 1000, // Convert to milliseconds
        sampleRate: this.sampleRate,
        hasVoice: true,
        amplitude: metrics.avgAmplitude,
        confidence: metrics.voiceConfidence,
        spectralCentroid: metrics.spectralCentroid,
        zeroCrossingRate: metrics.zeroCrossingRate
      });
      
      this.consecutiveVoiceFrames++;
      this.silenceFrames = 0;
    } else {
      this.consecutiveVoiceFrames = Math.max(0, this.consecutiveVoiceFrames - 1);
      this.silenceFrames++;
    }
  }

  calculateVoiceMetrics() {
    // Calculate average amplitude
    let sumAmplitude = 0;
    for (let i = 0; i < this.vadWindowSize; i++) {
      sumAmplitude += this.vadBuffer[i];
    }
    const avgAmplitude = sumAmplitude / this.vadWindowSize;
    
    // Calculate spectral centroid (indicates voice vs noise)
    const spectralCentroid = this.calculateSpectralCentroid();
    
    // Calculate zero-crossing rate (voice characteristic)
    const zeroCrossingRate = this.calculateZeroCrossingRate();
    
    // Calculate voice confidence based on multiple factors
    const voiceConfidence = this.calculateVoiceConfidence(avgAmplitude, spectralCentroid, zeroCrossingRate);
    
    return {
      avgAmplitude,
      spectralCentroid,
      zeroCrossingRate,
      voiceConfidence
    };
  }

  calculateSpectralCentroid() {
    // Simple spectral centroid calculation
    // In a full implementation, this would use FFT
    let weightedSum = 0;
    let magnitudeSum = 0;
    
    for (let i = 0; i < this.chunkSize; i++) {
      const magnitude = Math.abs(this.buffer[i]);
      const frequency = (i / this.chunkSize) * (this.sampleRate / 2);
      
      weightedSum += frequency * magnitude;
      magnitudeSum += magnitude;
    }
    
    return magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;
  }

  calculateZeroCrossingRate() {
    let crossings = 0;
    
    for (let i = 1; i < this.chunkSize; i++) {
      if ((this.buffer[i] >= 0) !== (this.buffer[i - 1] >= 0)) {
        crossings++;
      }
    }
    
    return crossings / this.chunkSize;
  }

  calculateVoiceConfidence(amplitude, spectralCentroid, zeroCrossingRate) {
    let confidence = 0;
    
    // Amplitude factor (voice typically has moderate amplitude)
    if (amplitude > this.voiceThreshold && amplitude < 0.3) {
      confidence += 0.4;
    }
    
    // Spectral centroid factor (voice typically 80Hz-8kHz range)
    if (spectralCentroid > 200 && spectralCentroid < 4000) {
      confidence += 0.3;
    }
    
    // Zero-crossing rate factor (voice has moderate ZCR)
    if (zeroCrossingRate > 0.02 && zeroCrossingRate < 0.3) {
      confidence += 0.3;
    }
    
    return Math.min(1.0, confidence);
  }

  detectVoiceActivity(metrics) {
    // Multi-factor voice activity detection
    const amplitudeCheck = metrics.avgAmplitude > this.voiceThreshold;
    const confidenceCheck = metrics.voiceConfidence > 0.6;
    const consistencyCheck = this.consecutiveVoiceFrames >= this.requiredVoiceFrames || 
                            this.silenceFrames < this.maxSilenceFrames;
    
    return amplitudeCheck && confidenceCheck && consistencyCheck;
  }

  enhanceVoiceChunk(buffer) {
    const enhanced = new Float32Array(buffer.length);
    
    for (let i = 0; i < buffer.length; i++) {
      let sample = buffer[i];
      
      // Soft limiter to prevent clipping while boosting quiet signals
      if (Math.abs(sample) > 0.7) {
        sample = sample > 0 ? 0.7 + 0.3 * Math.tanh((sample - 0.7) / 0.3) : 
                             -0.7 - 0.3 * Math.tanh((-sample - 0.7) / 0.3);
      } else if (Math.abs(sample) > this.noiseGateThreshold) {
        // Gentle gain for voice signals
        sample *= 1.2;
      }
      
      enhanced[i] = sample;
    }
    
    return enhanced;
  }
}

// Register the processor
registerProcessor('ultimate-audio-processor', UltimateAudioProcessor);