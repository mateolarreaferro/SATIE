/**
 * Client-side audio feature extraction using Web Audio API.
 * Used for AI auto-tagging of community samples.
 */

export interface AudioFeatures {
  durationMs: number;
  rms: number;
  peakAmplitude: number;
  spectralCentroid: number;       // Hz — higher = brighter
  zeroCrossingRate: number;       // 0–1 — higher = noisier
  waveformPeaks: number[];        // ~100 normalized peak values for mini waveform
  sampleRate: number;
  channels: number;
}

/**
 * Analyze an AudioBuffer and extract features for AI tagging.
 * All analysis is done offline (no real-time processing).
 */
export function analyzeAudioBuffer(buffer: AudioBuffer): AudioFeatures {
  const channelData = buffer.getChannelData(0); // analyze first channel
  const sampleRate = buffer.sampleRate;
  const length = channelData.length;

  // RMS and peak amplitude
  let sumSquares = 0;
  let peakAmplitude = 0;
  for (let i = 0; i < length; i++) {
    const sample = channelData[i];
    sumSquares += sample * sample;
    const abs = Math.abs(sample);
    if (abs > peakAmplitude) peakAmplitude = abs;
  }
  const rms = Math.sqrt(sumSquares / length);

  // Zero-crossing rate
  let zeroCrossings = 0;
  for (let i = 1; i < length; i++) {
    if ((channelData[i] >= 0) !== (channelData[i - 1] >= 0)) {
      zeroCrossings++;
    }
  }
  const zeroCrossingRate = zeroCrossings / length;

  // Spectral centroid estimate via FFT
  const spectralCentroid = estimateSpectralCentroid(channelData, sampleRate);

  // Waveform peaks for visualization (~100 bins)
  const waveformPeaks = computeWaveformPeaks(channelData, 100);

  return {
    durationMs: Math.round((length / sampleRate) * 1000),
    rms: Math.round(rms * 1000) / 1000,
    peakAmplitude: Math.round(peakAmplitude * 1000) / 1000,
    spectralCentroid: Math.round(spectralCentroid),
    zeroCrossingRate: Math.round(zeroCrossingRate * 10000) / 10000,
    waveformPeaks,
    sampleRate,
    channels: buffer.numberOfChannels,
  };
}

/**
 * Estimate spectral centroid using a simple DFT on a windowed segment.
 * Takes the middle segment of the audio for a representative estimate.
 */
function estimateSpectralCentroid(samples: Float32Array, sampleRate: number): number {
  // Use a 4096-sample window from the middle of the audio
  const fftSize = 4096;
  const start = Math.max(0, Math.floor(samples.length / 2) - fftSize / 2);
  const end = Math.min(samples.length, start + fftSize);
  const segment = samples.slice(start, end);

  if (segment.length < 64) return 0;

  // Apply Hann window
  const windowed = new Float32Array(segment.length);
  for (let i = 0; i < segment.length; i++) {
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (segment.length - 1)));
    windowed[i] = segment[i] * hann;
  }

  // Compute magnitude spectrum using DFT (for short segments this is fine)
  const n = windowed.length;
  const halfN = Math.floor(n / 2);
  let weightedSum = 0;
  let magnitudeSum = 0;

  for (let k = 0; k < halfN; k++) {
    let real = 0;
    let imag = 0;
    for (let t = 0; t < n; t++) {
      const angle = (2 * Math.PI * k * t) / n;
      real += windowed[t] * Math.cos(angle);
      imag -= windowed[t] * Math.sin(angle);
    }
    const magnitude = Math.sqrt(real * real + imag * imag);
    const frequency = (k * sampleRate) / n;
    weightedSum += frequency * magnitude;
    magnitudeSum += magnitude;
  }

  return magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;
}

/**
 * Compute normalized peak values for waveform visualization.
 * Divides the audio into `numBins` segments and returns the max absolute value in each.
 */
function computeWaveformPeaks(samples: Float32Array, numBins: number): number[] {
  const binSize = Math.floor(samples.length / numBins);
  if (binSize === 0) return Array(numBins).fill(0);

  const peaks: number[] = [];
  for (let i = 0; i < numBins; i++) {
    let max = 0;
    const start = i * binSize;
    const end = Math.min(start + binSize, samples.length);
    for (let j = start; j < end; j++) {
      const abs = Math.abs(samples[j]);
      if (abs > max) max = abs;
    }
    peaks.push(Math.round(max * 1000) / 1000);
  }

  return peaks;
}
