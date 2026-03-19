/**
 * Granular pitch shifter AudioWorklet.
 * Two overlapping Hann-windowed grains read from a circular buffer
 * at a modified rate. When a grain expires it resets near the write head.
 * Hann windows offset by half grain size sum to 1.0 (constant power).
 */
class PitchShifterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pitchFactor = 1.0;
    this.bufLen = 8192;
    this.grainSize = 2048;
    this.halfGrain = this.grainSize / 2;

    // Circular buffers per channel (max 2)
    this.buf = [new Float32Array(this.bufLen), new Float32Array(this.bufLen)];
    this.wPos = 0;

    // Two read heads (shared across channels since they read same positions)
    this.rPos = [0, this.halfGrain];
    this.rPhase = [0, this.halfGrain];

    // Pre-compute Hann window
    this.win = new Float32Array(this.grainSize);
    for (let i = 0; i < this.grainSize; i++) {
      this.win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / this.grainSize));
    }

    this.port.onmessage = (e) => {
      if (e.data.pitchFactor !== undefined) this.pitchFactor = e.data.pitchFactor;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    const pf = this.pitchFactor;

    // Passthrough when no shift needed
    if (Math.abs(pf - 1.0) < 0.0005) {
      for (let c = 0; c < output.length; c++) {
        if (input[c]) output[c].set(input[c]);
      }
      return true;
    }

    const n = input[0].length;
    const chCount = Math.min(input.length, output.length, 2);
    const mask = this.bufLen - 1;

    for (let i = 0; i < n; i++) {
      // Write all channels to circular buffer
      for (let c = 0; c < chCount; c++) {
        this.buf[c][this.wPos & mask] = input[c][i];
      }

      // Sum output from two staggered grains
      for (let c = 0; c < chCount; c++) output[c][i] = 0;

      for (let g = 0; g < 2; g++) {
        const rp = this.rPos[g];
        const idx = Math.floor(rp) & mask;
        const frac = rp - Math.floor(rp);
        const w = this.win[this.rPhase[g]];

        for (let c = 0; c < chCount; c++) {
          const s = this.buf[c][idx] * (1 - frac) + this.buf[c][(idx + 1) & mask] * frac;
          output[c][i] += s * w;
        }

        // Advance read head at pitch rate
        this.rPos[g] += pf;
        this.rPhase[g]++;

        // Reset grain when expired
        if (this.rPhase[g] >= this.grainSize) {
          this.rPhase[g] = 0;
          this.rPos[g] = this.wPos - this.grainSize;
        }
      }

      this.wPos++;
    }

    return true;
  }
}

registerProcessor('pitch-shifter-processor', PitchShifterProcessor);
