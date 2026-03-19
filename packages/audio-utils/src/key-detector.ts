/**
 * Musical key detection via HPCP (Harmonic Pitch Class Profile).
 * Uses CQT-like log-frequency mapping with harmonic weighting,
 * matched against Temperley and Krumhansl-Kessler key profiles.
 */

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Krumhansl-Kessler profiles
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Temperley profiles (better for pop/rock)
const TEMPERLEY_MAJOR = [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0];
const TEMPERLEY_MINOR = [5.0, 2.0, 3.5, 4.5, 2.0, 3.5, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0];

function getMonoData(buffer: AudioBuffer): Float32Array {
  const ch0 = buffer.getChannelData(0);
  if (buffer.numberOfChannels === 1) return ch0;
  const ch1 = buffer.getChannelData(1);
  const mono = new Float32Array(ch0.length);
  for (let i = 0; i < ch0.length; i++) {
    mono[i] = (ch0[i] + ch1[i]) * 0.5;
  }
  return mono;
}

function fftMagnitude(signal: Float32Array, n: number): Float32Array {
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < signal.length && i < n; i++) re[i] = signal[i];

  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let j = 0;
    for (let b = 0; b < bits; b++) {
      j = (j << 1) | ((i >> b) & 1);
    }
    if (j > i) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const angle = (-2 * Math.PI) / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < half; j++) {
        const wr = Math.cos(angle * j);
        const wi = Math.sin(angle * j);
        const tr = re[i + j + half] * wr - im[i + j + half] * wi;
        const ti = re[i + j + half] * wi + im[i + j + half] * wr;
        re[i + j + half] = re[i + j] - tr;
        im[i + j + half] = im[i + j] - ti;
        re[i + j] += tr;
        im[i + j] += ti;
      }
    }
  }

  const mag = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }
  return mag;
}

/**
 * Build HPCP — Harmonic Pitch Class Profile.
 * Each FFT bin's energy is distributed to pitch classes
 * with weighting for harmonics (partials 1-6).
 */
function buildHPCP(mono: Float32Array, sampleRate: number): Float32Array {
  const hpcp = new Float32Array(12);
  const fftSize = 8192;
  const hop = 4096;
  const numFrames = Math.floor((mono.length - fftSize) / hop);
  if (numFrames <= 0) return hpcp;

  // Analyze multiple segments across the track (skip intro/outro)
  const skipFrames = Math.min(Math.floor(numFrames * 0.1), Math.floor((5 * sampleRate) / hop));
  const startFrame = skipFrames;
  const endFrame = numFrames - skipFrames;
  const maxFrames = Math.min(endFrame - startFrame, Math.floor((45 * sampleRate) / hop));

  if (maxFrames <= 0) return hpcp;

  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1)); // Hann
  }

  const freqRes = sampleRate / fftSize;
  const segment = new Float32Array(fftSize);
  const NUM_HARMONICS = 6;
  const HARMONIC_WEIGHTS = [1.0, 0.5, 0.33, 0.25, 0.2, 0.15];

  for (let f = startFrame; f < startFrame + maxFrames; f++) {
    const start = f * hop;
    for (let i = 0; i < fftSize; i++) {
      segment[i] = mono[start + i] * window[i];
    }

    const mag = fftMagnitude(segment, fftSize);

    // Find spectral peaks (local maxima)
    for (let bin = 2; bin < mag.length - 2; bin++) {
      if (mag[bin] <= mag[bin - 1] || mag[bin] <= mag[bin + 1]) continue;

      const freq = bin * freqRes;
      if (freq < 55 || freq > 4000) continue; // A1 to B7

      const amplitude = mag[bin];
      // Threshold: ignore low-energy peaks
      if (amplitude < 0.001) continue;

      // Assign to pitch class with harmonic consideration
      // For each peak, check if it could be harmonic N of a fundamental
      for (let h = 1; h <= NUM_HARMONICS; h++) {
        const fundamental = freq / h;
        if (fundamental < 55 || fundamental > 2000) continue;

        const midiNote = 12 * Math.log2(fundamental / 440) + 69;
        const pitchClass = ((Math.round(midiNote) % 12) + 12) % 12;

        // Weight by amplitude^2 (energy) and harmonic weight
        hpcp[pitchClass] += amplitude * amplitude * HARMONIC_WEIGHTS[h - 1];
      }
    }
  }

  // Normalize
  let maxVal = 0;
  for (let i = 0; i < 12; i++) {
    if (hpcp[i] > maxVal) maxVal = hpcp[i];
  }
  if (maxVal > 0) {
    for (let i = 0; i < 12; i++) hpcp[i] /= maxVal;
  }

  return hpcp;
}

/** Pearson correlation between pitch class profile and key template */
function correlate(profile: Float32Array, template: number[]): number {
  let sumA = 0, sumB = 0;
  for (let i = 0; i < 12; i++) { sumA += profile[i]; sumB += template[i]; }
  const meanA = sumA / 12;
  const meanB = sumB / 12;
  let num = 0, dA = 0, dB = 0;
  for (let i = 0; i < 12; i++) {
    const da = profile[i] - meanA;
    const db = template[i] - meanB;
    num += da * db;
    dA += da * da;
    dB += db * db;
  }
  const denom = Math.sqrt(dA * dB);
  return denom === 0 ? 0 : num / denom;
}

export function detectKey(buffer: AudioBuffer): string {
  const mono = getMonoData(buffer);
  const hpcp = buildHPCP(mono, buffer.sampleRate);

  let bestKey = "C";
  let bestScore = -Infinity;

  for (let shift = 0; shift < 12; shift++) {
    // Rotate HPCP so index 0 = the candidate root
    const rotated = new Float32Array(12);
    for (let i = 0; i < 12; i++) {
      rotated[i] = hpcp[(i + shift) % 12];
    }

    // Test against both profile sets, take best
    const kkMajor = correlate(rotated, KK_MAJOR);
    const kkMinor = correlate(rotated, KK_MINOR);
    const tMajor = correlate(rotated, TEMPERLEY_MAJOR);
    const tMinor = correlate(rotated, TEMPERLEY_MINOR);

    // Best of both profiles for major
    const majorScore = Math.max(kkMajor, tMajor);
    if (majorScore > bestScore) {
      bestScore = majorScore;
      bestKey = NOTE_NAMES[shift] + " MAJOR";
    }

    const minorScore = Math.max(kkMinor, tMinor);
    if (minorScore > bestScore) {
      bestScore = minorScore;
      bestKey = NOTE_NAMES[shift] + " MINOR";
    }
  }

  return bestKey;
}
