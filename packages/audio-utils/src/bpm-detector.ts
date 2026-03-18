/**
 * BPM detection via autocorrelation on onset energy envelope.
 * Operates on a decoded AudioBuffer, returns estimated BPM (60–200 range).
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

function computeEnergy(samples: Float32Array, sampleRate: number, hopSize: number): Float32Array {
  const windowSize = Math.round(sampleRate * 0.02); // 20ms window
  const numFrames = Math.floor((samples.length - windowSize) / hopSize);
  const energy = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    const start = f * hopSize;
    for (let i = start; i < start + windowSize; i++) {
      sum += samples[i] * samples[i];
    }
    energy[f] = sum / windowSize;
  }
  return energy;
}

function onsetEnvelope(energy: Float32Array): Float32Array {
  const onset = new Float32Array(energy.length);
  for (let i = 1; i < energy.length; i++) {
    const diff = energy[i] - energy[i - 1];
    onset[i] = diff > 0 ? diff : 0;
  }
  return onset;
}

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

export function detectBPM(buffer: AudioBuffer): number {
  const sampleRate = buffer.sampleRate;
  const mono = getMonoData(buffer);

  // Low-pass filter to focus on kick/bass energy
  const filtered = new Float32Array(mono.length);
  const alpha = 0.1;
  filtered[0] = mono[0];
  for (let i = 1; i < mono.length; i++) {
    filtered[i] = alpha * mono[i] + (1 - alpha) * filtered[i - 1];
  }

  const hopSize = Math.round(sampleRate * 0.01); // 10ms hops
  const energy = computeEnergy(filtered, sampleRate, hopSize);
  const onset = onsetEnvelope(energy);

  // BPM range 60–200 → lag range in onset frames
  const framesPerSecond = sampleRate / hopSize;
  const minBPM = 60;
  const maxBPM = 200;
  const minLag = Math.floor((60 / maxBPM) * framesPerSecond);
  const maxLag = Math.ceil((60 / minBPM) * framesPerSecond);

  const clampedMax = Math.min(maxLag, onset.length - 1);
  if (clampedMax <= minLag) return 0;

  const acf = autocorrelate(onset, minLag, clampedMax);

  // Find peak
  let bestIdx = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < acf.length; i++) {
    if (acf[i] > bestVal) {
      bestVal = acf[i];
      bestIdx = i;
    }
  }

  const bestLag = bestIdx + minLag;
  const bpm = (60 * framesPerSecond) / bestLag;

  return Math.round(bpm);
}
