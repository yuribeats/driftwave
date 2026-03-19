/**
 * BPM detection via multi-band spectral flux onset + autocorrelation
 * with octave error correction. Returns estimated BPM (60–200 range).
 */

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

/** Simple real-valued FFT magnitude using radix-2 DIT */
function fftMagnitude(re: Float32Array, im: Float32Array): Float32Array {
  const n = re.length;
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

/** Spectral flux onset detection — captures percussive energy changes */
function spectralFlux(
  mono: Float32Array,
  sampleRate: number,
  fftSize: number,
  hop: number,
  lowBin: number,
  highBin: number,
): Float32Array {
  const numFrames = Math.floor((mono.length - fftSize) / hop);
  if (numFrames <= 1) return new Float32Array(0);

  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1)); // Hann
  }

  const flux = new Float32Array(numFrames);
  let prevMag: Float32Array | null = null;

  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);

  for (let f = 0; f < numFrames; f++) {
    const start = f * hop;
    for (let i = 0; i < fftSize; i++) {
      re[i] = mono[start + i] * window[i];
      im[i] = 0;
    }
    const mag = fftMagnitude(re, im);

    if (prevMag) {
      let sum = 0;
      const lo = Math.max(1, lowBin);
      const hi = Math.min(mag.length - 1, highBin);
      for (let i = lo; i <= hi; i++) {
        const diff = mag[i] - prevMag[i];
        if (diff > 0) sum += diff; // half-wave rectify
      }
      flux[f] = sum;
    }
    prevMag = mag.slice();
  }

  return flux;
}

/** Autocorrelation of onset function */
function autocorrelate(signal: Float32Array, minLag: number, maxLag: number): Float32Array {
  const result = new Float32Array(maxLag - minLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const n = signal.length - lag;
    for (let i = 0; i < n; i++) {
      sum += signal[i] * signal[i + lag];
    }
    result[lag - minLag] = sum / n;
  }
  return result;
}

/** Find top N peaks in autocorrelation */
function findPeaks(acf: Float32Array, minLag: number, count: number): { lag: number; value: number }[] {
  const peaks: { lag: number; value: number }[] = [];
  for (let i = 1; i < acf.length - 1; i++) {
    if (acf[i] > acf[i - 1] && acf[i] > acf[i + 1]) {
      peaks.push({ lag: i + minLag, value: acf[i] });
    }
  }
  peaks.sort((a, b) => b.value - a.value);
  return peaks.slice(0, count);
}

/** Comb filter energy — reinforces periodicities that are multiples */
function combFilterScore(onset: Float32Array, lag: number, numPulses: number): number {
  let score = 0;
  for (let p = 1; p <= numPulses; p++) {
    const pLag = lag * p;
    if (pLag >= onset.length) break;
    let sum = 0;
    const n = onset.length - pLag;
    for (let i = 0; i < n; i++) {
      sum += onset[i] * onset[i + pLag];
    }
    score += sum / n / p; // diminishing weight for higher harmonics
  }
  return score;
}

export function detectBPM(buffer: AudioBuffer): number {
  const sampleRate = buffer.sampleRate;
  const mono = getMonoData(buffer);

  // Use up to 60 seconds from the middle of the track
  const maxSamples = sampleRate * 60;
  let segment: Float32Array;
  if (mono.length > maxSamples) {
    const offset = Math.floor((mono.length - maxSamples) / 2);
    segment = mono.subarray(offset, offset + maxSamples);
  } else {
    segment = mono;
  }

  const fftSize = 2048;
  const hop = 512;
  const framesPerSecond = sampleRate / hop;
  const freqRes = sampleRate / fftSize;

  // Multi-band spectral flux: low (kick), mid (snare), full
  const lowFlux = spectralFlux(segment, sampleRate, fftSize, hop,
    Math.round(30 / freqRes), Math.round(250 / freqRes));
  const midFlux = spectralFlux(segment, sampleRate, fftSize, hop,
    Math.round(250 / freqRes), Math.round(4000 / freqRes));
  const fullFlux = spectralFlux(segment, sampleRate, fftSize, hop,
    1, Math.round(8000 / freqRes));

  // Combine bands with weights (kick-heavy for rhythm)
  const len = Math.min(lowFlux.length, midFlux.length, fullFlux.length);
  if (len < 10) return 0;
  const combined = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    combined[i] = lowFlux[i] * 2.0 + midFlux[i] * 1.0 + fullFlux[i] * 0.5;
  }

  // Normalize
  let maxCombined = 0;
  for (let i = 0; i < len; i++) {
    if (combined[i] > maxCombined) maxCombined = combined[i];
  }
  if (maxCombined > 0) {
    for (let i = 0; i < len; i++) combined[i] /= maxCombined;
  }

  // BPM range 60–200
  const minBPM = 60;
  const maxBPM = 200;
  const minLag = Math.floor((60 / maxBPM) * framesPerSecond);
  const maxLag = Math.ceil((60 / minBPM) * framesPerSecond);
  const clampedMax = Math.min(maxLag, len - 1);
  if (clampedMax <= minLag) return 0;

  const acf = autocorrelate(combined, minLag, clampedMax);
  const peaks = findPeaks(acf, minLag, 10);
  if (peaks.length === 0) return 0;

  // Score each candidate with comb filter energy + tempo prior
  let bestBPM = 0;
  let bestScore = -Infinity;

  for (const peak of peaks) {
    const bpm = (60 * framesPerSecond) / peak.lag;

    // Comb filter reinforcement (checks multiples are also strong)
    const combScore = combFilterScore(combined, peak.lag, 4);

    // Tempo prior — prefer common BPM ranges (centered around 120)
    const tempoPrior = Math.exp(-0.5 * Math.pow((bpm - 120) / 40, 2));

    // Penalize very low or very high tempos
    const rangePenalty = (bpm < 70 || bpm > 180) ? 0.7 : 1.0;

    const score = (peak.value * 0.4 + combScore * 0.6) * tempoPrior * rangePenalty;

    if (score > bestScore) {
      bestScore = score;
      bestBPM = bpm;
    }

    // Also test octave variants (half/double)
    for (const mult of [0.5, 2.0]) {
      const altBPM = bpm * mult;
      if (altBPM < minBPM || altBPM > maxBPM) continue;
      const altLag = Math.round((60 * framesPerSecond) / altBPM);
      const altComb = combFilterScore(combined, altLag, 4);
      const altPrior = Math.exp(-0.5 * Math.pow((altBPM - 120) / 40, 2));
      const altRange = (altBPM < 70 || altBPM > 180) ? 0.7 : 1.0;
      const altScore = (peak.value * 0.3 + altComb * 0.7) * altPrior * altRange;
      if (altScore > bestScore) {
        bestScore = altScore;
        bestBPM = altBPM;
      }
    }
  }

  return Math.round(bestBPM);
}
