/**
 * Musical key detection via chromagram analysis.
 * Uses FFT to build pitch class profile, matches against major/minor key templates.
 */

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Krumhansl-Kessler key profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

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

function hammingWindow(size: number): Float32Array {
  const win = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    win[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return win;
}

function fftMagnitude(signal: Float32Array): Float32Array {
  const n = signal.length;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  re.set(signal);

  // In-place radix-2 FFT
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let j = 0;
    for (let b = 0; b < bits; b++) {
      j = (j << 1) | ((i >> b) & 1);
    }
    if (j > i) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
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

function buildChromagram(mono: Float32Array, sampleRate: number): Float32Array {
  const chroma = new Float32Array(12);
  const fftSize = 8192;
  const hop = 4096;
  const window = hammingWindow(fftSize);
  const numFrames = Math.floor((mono.length - fftSize) / hop);

  if (numFrames <= 0) return chroma;

  // Analyze up to ~30 seconds for speed
  const maxFrames = Math.min(numFrames, Math.floor((30 * sampleRate) / hop));
  const segment = new Float32Array(fftSize);

  for (let f = 0; f < maxFrames; f++) {
    const start = f * hop;
    for (let i = 0; i < fftSize; i++) {
      segment[i] = mono[start + i] * window[i];
    }

    const mag = fftMagnitude(segment);
    const freqRes = sampleRate / fftSize;

    // Map frequency bins to pitch classes (A4 = 440Hz)
    for (let bin = 1; bin < mag.length; bin++) {
      const freq = bin * freqRes;
      if (freq < 65 || freq > 2000) continue; // C2 to B6 range
      const midiNote = 12 * Math.log2(freq / 440) + 69;
      const pitchClass = Math.round(midiNote) % 12;
      if (pitchClass >= 0 && pitchClass < 12) {
        chroma[pitchClass] += mag[bin] * mag[bin]; // energy
      }
    }
  }

  // Normalize
  let maxVal = 0;
  for (let i = 0; i < 12; i++) {
    if (chroma[i] > maxVal) maxVal = chroma[i];
  }
  if (maxVal > 0) {
    for (let i = 0; i < 12; i++) {
      chroma[i] /= maxVal;
    }
  }

  return chroma;
}

function correlate(a: Float32Array, b: number[]): number {
  let sum = 0;
  let sumA = 0, sumB = 0;
  for (let i = 0; i < 12; i++) sumA += a[i];
  for (let i = 0; i < 12; i++) sumB += b[i];
  const meanA = sumA / 12;
  const meanB = sumB / 12;
  let dA = 0, dB = 0;
  for (let i = 0; i < 12; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    sum += da * db;
    dA += da * da;
    dB += db * db;
  }
  const denom = Math.sqrt(dA * dB);
  return denom === 0 ? 0 : sum / denom;
}

export function detectKey(buffer: AudioBuffer): string {
  const mono = getMonoData(buffer);
  const chroma = buildChromagram(mono, buffer.sampleRate);

  let bestKey = "C";
  let bestScore = -Infinity;

  for (let shift = 0; shift < 12; shift++) {
    // Rotate chroma to test each root note
    const rotated = new Float32Array(12);
    for (let i = 0; i < 12; i++) {
      rotated[i] = chroma[(i + shift) % 12];
    }

    const majorScore = correlate(rotated, MAJOR_PROFILE);
    if (majorScore > bestScore) {
      bestScore = majorScore;
      bestKey = NOTE_NAMES[shift] + " MAJOR";
    }

    const minorScore = correlate(rotated, MINOR_PROFILE);
    if (minorScore > bestScore) {
      bestScore = minorScore;
      bestKey = NOTE_NAMES[shift] + " MINOR";
    }
  }

  return bestKey;
}
