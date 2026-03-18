/**
 * Detect the first significant transient in an AudioBuffer.
 * Returns the time in seconds of the first major onset.
 */

export function detectFirstTransient(buffer: AudioBuffer): number {
  const sampleRate = buffer.sampleRate;
  const ch0 = buffer.getChannelData(0);

  // Use ~10ms window for energy calculation
  const windowSize = Math.round(sampleRate * 0.01);
  const hopSize = Math.round(sampleRate * 0.005); // 5ms hop
  const numFrames = Math.floor((ch0.length - windowSize) / hopSize);

  if (numFrames < 2) return 0;

  // Compute RMS energy per frame
  const energy = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    const start = f * hopSize;
    for (let i = start; i < start + windowSize; i++) {
      sum += ch0[i] * ch0[i];
    }
    energy[f] = Math.sqrt(sum / windowSize);
  }

  // Find peak energy for threshold calculation
  let peak = 0;
  for (let i = 0; i < numFrames; i++) {
    if (energy[i] > peak) peak = energy[i];
  }

  if (peak === 0) return 0;

  // Threshold: first frame that exceeds 15% of peak energy
  // AND has a sharp rise (onset) compared to previous frames
  const threshold = peak * 0.15;

  for (let i = 4; i < numFrames; i++) {
    if (energy[i] > threshold) {
      // Verify it's a real onset — energy should be rising
      const prevAvg = (energy[i - 1] + energy[i - 2] + energy[i - 3] + energy[i - 4]) / 4;
      const ratio = prevAvg > 0 ? energy[i] / prevAvg : Infinity;
      if (ratio > 2.0) {
        // Back up slightly to catch the attack
        const backupFrames = 2;
        const frame = Math.max(0, i - backupFrames);
        return (frame * hopSize) / sampleRate;
      }
    }
  }

  // Fallback: just find the first frame above threshold
  for (let i = 0; i < numFrames; i++) {
    if (energy[i] > threshold) {
      return (i * hopSize) / sampleRate;
    }
  }

  return 0;
}
