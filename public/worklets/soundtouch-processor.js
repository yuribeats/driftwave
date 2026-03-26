/*
 * SoundTouch JS v0.3.0 audio processing library
 * Copyright (c) Olli Parviainen
 * Copyright (c) Ryan Berdeen
 * Copyright (c) Jakub Fiala
 * Copyright (c) Steve 'Cutter' Blades
 *
 * LGPL v2.1 — see soundtouchjs package for full license text.
 *
 * Inlined here for use as a self-contained AudioWorkletProcessor.
 */

class FifoSampleBuffer {
  constructor() {
    this._vector = new Float32Array();
    this._position = 0;
    this._frameCount = 0;
  }
  get vector() { return this._vector; }
  get position() { return this._position; }
  get startIndex() { return this._position * 2; }
  get frameCount() { return this._frameCount; }
  get endIndex() { return (this._position + this._frameCount) * 2; }
  clear() { this._vector.fill(0); this._position = 0; this._frameCount = 0; }
  put(numFrames) { this._frameCount += numFrames; }
  putSamples(samples, position, numFrames = 0) {
    position = position || 0;
    const sourceOffset = position * 2;
    if (!(numFrames >= 0)) numFrames = (samples.length - sourceOffset) / 2;
    const numSamples = numFrames * 2;
    this.ensureCapacity(numFrames + this._frameCount);
    const destOffset = this.endIndex;
    this.vector.set(samples.subarray(sourceOffset, sourceOffset + numSamples), destOffset);
    this._frameCount += numFrames;
  }
  putBuffer(buffer, position, numFrames = 0) {
    position = position || 0;
    if (!(numFrames >= 0)) numFrames = buffer.frameCount - position;
    this.putSamples(buffer.vector, buffer.position + position, numFrames);
  }
  receive(numFrames) {
    if (!(numFrames >= 0) || numFrames > this._frameCount) numFrames = this.frameCount;
    this._frameCount -= numFrames;
    this._position += numFrames;
  }
  receiveSamples(output, numFrames = 0) {
    const numSamples = numFrames * 2;
    const sourceOffset = this.startIndex;
    output.set(this._vector.subarray(sourceOffset, sourceOffset + numSamples));
    this.receive(numFrames);
  }
  extract(output, position = 0, numFrames = 0) {
    const sourceOffset = this.startIndex + position * 2;
    const numSamples = numFrames * 2;
    output.set(this._vector.subarray(sourceOffset, sourceOffset + numSamples));
  }
  ensureCapacity(numFrames = 0) {
    const minLength = parseInt(numFrames * 2);
    if (this._vector.length < minLength) {
      const newVector = new Float32Array(minLength);
      newVector.set(this._vector.subarray(this.startIndex, this.endIndex));
      this._vector = newVector;
      this._position = 0;
    } else {
      this.rewind();
    }
  }
  ensureAdditionalCapacity(numFrames = 0) { this.ensureCapacity(this._frameCount + numFrames); }
  rewind() {
    if (this._position > 0) {
      this._vector.set(this._vector.subarray(this.startIndex, this.endIndex));
      this._position = 0;
    }
  }
}

class AbstractFifoSamplePipe {
  constructor(createBuffers) {
    if (createBuffers) {
      this._inputBuffer = new FifoSampleBuffer();
      this._outputBuffer = new FifoSampleBuffer();
    } else {
      this._inputBuffer = this._outputBuffer = null;
    }
  }
  get inputBuffer() { return this._inputBuffer; }
  set inputBuffer(b) { this._inputBuffer = b; }
  get outputBuffer() { return this._outputBuffer; }
  set outputBuffer(b) { this._outputBuffer = b; }
  clear() { this._inputBuffer.clear(); this._outputBuffer.clear(); }
}

class RateTransposer extends AbstractFifoSamplePipe {
  constructor(createBuffers) {
    super(createBuffers);
    this.reset();
    this._rate = 1;
  }
  set rate(rate) { this._rate = rate; }
  reset() { this.slopeCount = 0; this.prevSampleL = 0; this.prevSampleR = 0; }
  clear() { super.clear(); this.reset(); }
  process() {
    const numFrames = this._inputBuffer.frameCount;
    this._outputBuffer.ensureAdditionalCapacity(numFrames / this._rate + 1);
    const numFramesOutput = this.transpose(numFrames);
    this._inputBuffer.receive();
    this._outputBuffer.put(numFramesOutput);
  }
  transpose(numFrames = 0) {
    if (numFrames === 0) return 0;
    const src = this._inputBuffer.vector;
    const srcOffset = this._inputBuffer.startIndex;
    const dest = this._outputBuffer.vector;
    const destOffset = this._outputBuffer.endIndex;
    let used = 0, i = 0;
    while (this.slopeCount < 1.0) {
      dest[destOffset + 2 * i] = (1.0 - this.slopeCount) * this.prevSampleL + this.slopeCount * src[srcOffset];
      dest[destOffset + 2 * i + 1] = (1.0 - this.slopeCount) * this.prevSampleR + this.slopeCount * src[srcOffset + 1];
      i++;
      this.slopeCount += this._rate;
    }
    this.slopeCount -= 1.0;
    if (numFrames !== 1) {
      out: while (true) {
        while (this.slopeCount > 1.0) {
          this.slopeCount -= 1.0;
          used++;
          if (used >= numFrames - 1) break out;
        }
        const srcIndex = srcOffset + 2 * used;
        dest[destOffset + 2 * i] = (1.0 - this.slopeCount) * src[srcIndex] + this.slopeCount * src[srcIndex + 2];
        dest[destOffset + 2 * i + 1] = (1.0 - this.slopeCount) * src[srcIndex + 1] + this.slopeCount * src[srcIndex + 3];
        i++;
        this.slopeCount += this._rate;
      }
    }
    this.prevSampleL = src[srcOffset + 2 * numFrames - 2];
    this.prevSampleR = src[srcOffset + 2 * numFrames - 1];
    return i;
  }
}

const _SCAN_OFFSETS = [
  [124,186,248,310,372,434,496,558,620,682,744,806,868,930,992,1054,1116,1178,1240,1302,1364,1426,1488,0],
  [-100,-75,-50,-25,25,50,75,100,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [-20,-15,-10,-5,5,10,15,20,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [-4,-3,-2,-1,1,2,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
];
const AUTOSEQ_TEMPO_LOW = 0.25, AUTOSEQ_TEMPO_TOP = 4.0;
const AUTOSEQ_AT_MIN = 125.0, AUTOSEQ_AT_MAX = 50.0;
const AUTOSEQ_K = (AUTOSEQ_AT_MAX - AUTOSEQ_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
const AUTOSEQ_C = AUTOSEQ_AT_MIN - AUTOSEQ_K * AUTOSEQ_TEMPO_LOW;
const AUTOSEEK_AT_MIN = 25.0, AUTOSEEK_AT_MAX = 15.0;
const AUTOSEEK_K = (AUTOSEEK_AT_MAX - AUTOSEEK_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
const AUTOSEEK_C = AUTOSEEK_AT_MIN - AUTOSEEK_K * AUTOSEQ_TEMPO_LOW;
const DEFAULT_OVERLAP_MS = 8;

class Stretch extends AbstractFifoSamplePipe {
  constructor(createBuffers) {
    super(createBuffers);
    this._quickSeek = true;
    this.midBufferDirty = false;
    this.midBuffer = null;
    this.overlapLength = 0;
    this.autoSeqSetting = true;
    this.autoSeekSetting = true;
    this._tempo = 1;
    this.setParameters(44100, 0, 0, DEFAULT_OVERLAP_MS);
  }
  clear() { super.clear(); this.clearMidBuffer(); }
  clearMidBuffer() {
    this.midBufferDirty = false;
    this.midBuffer = null;
    if (this.refMidBuffer) this.refMidBuffer.fill(0);
    this.skipFract = 0;
  }
  setParameters(sampleRate, sequenceMs, seekWindowMs, overlapMs) {
    if (sampleRate > 0) this.sampleRate = sampleRate;
    if (overlapMs > 0) this.overlapMs = overlapMs;
    if (sequenceMs > 0) { this.sequenceMs = sequenceMs; this.autoSeqSetting = false; } else { this.autoSeqSetting = true; }
    if (seekWindowMs > 0) { this.seekWindowMs = seekWindowMs; this.autoSeekSetting = false; } else { this.autoSeekSetting = true; }
    this.calculateSequenceParameters();
    this.calculateOverlapLength(this.overlapMs);
    this.tempo = this._tempo;
  }
  set tempo(newTempo) {
    this._tempo = newTempo;
    this.calculateSequenceParameters();
    this.nominalSkip = this._tempo * (this.seekWindowLength - this.overlapLength);
    this.skipFract = 0;
    const intskip = Math.floor(this.nominalSkip + 0.5);
    this.sampleReq = Math.max(intskip + this.overlapLength, this.seekWindowLength) + this.seekLength;
  }
  get tempo() { return this._tempo; }
  get inputChunkSize() { return this.sampleReq; }
  get outputChunkSize() { return this.overlapLength + Math.max(0, this.seekWindowLength - 2 * this.overlapLength); }
  calculateOverlapLength(overlapInMsec = 0) {
    let newOvl = this.sampleRate * overlapInMsec / 1000;
    newOvl = newOvl < 16 ? 16 : newOvl;
    newOvl -= newOvl % 8;
    this.overlapLength = newOvl;
    this.refMidBuffer = new Float32Array(this.overlapLength * 2);
    this.midBuffer = new Float32Array(this.overlapLength * 2);
  }
  checkLimits(x, mi, ma) { return x < mi ? mi : x > ma ? ma : x; }
  calculateSequenceParameters() {
    if (this.autoSeqSetting) {
      let seq = AUTOSEQ_C + AUTOSEQ_K * this._tempo;
      seq = this.checkLimits(seq, AUTOSEQ_AT_MAX, AUTOSEQ_AT_MIN);
      this.sequenceMs = Math.floor(seq + 0.5);
    }
    if (this.autoSeekSetting) {
      let seek = AUTOSEEK_C + AUTOSEEK_K * this._tempo;
      seek = this.checkLimits(seek, AUTOSEEK_AT_MAX, AUTOSEEK_AT_MIN);
      this.seekWindowMs = Math.floor(seek + 0.5);
    }
    this.seekWindowLength = Math.floor(this.sampleRate * this.sequenceMs / 1000);
    this.seekLength = Math.floor(this.sampleRate * this.seekWindowMs / 1000);
  }
  set quickSeek(enable) { this._quickSeek = enable; }
  seekBestOverlapPosition() {
    return this._quickSeek ? this.seekBestOverlapPositionStereoQuick() : this.seekBestOverlapPositionStereo();
  }
  seekBestOverlapPositionStereo() {
    this.preCalculateCorrelationReferenceStereo();
    let bestOffset = 0, bestCorrelation = Number.MIN_VALUE;
    for (let i = 0; i < this.seekLength; i++) {
      const correlation = this.calculateCrossCorrelationStereo(2 * i, this.refMidBuffer);
      if (correlation > bestCorrelation) { bestCorrelation = correlation; bestOffset = i; }
    }
    return bestOffset;
  }
  seekBestOverlapPositionStereoQuick() {
    this.preCalculateCorrelationReferenceStereo();
    let bestCorrelation = Number.MIN_VALUE, bestOffset = 0, correlationOffset = 0, tempOffset = 0;
    for (let scanCount = 0; scanCount < 4; scanCount++) {
      let j = 0;
      while (_SCAN_OFFSETS[scanCount][j]) {
        tempOffset = correlationOffset + _SCAN_OFFSETS[scanCount][j];
        if (tempOffset >= this.seekLength) break;
        const correlation = this.calculateCrossCorrelationStereo(2 * tempOffset, this.refMidBuffer);
        if (correlation > bestCorrelation) { bestCorrelation = correlation; bestOffset = tempOffset; }
        j++;
      }
      correlationOffset = bestOffset;
    }
    return bestOffset;
  }
  preCalculateCorrelationReferenceStereo() {
    for (let i = 0; i < this.overlapLength; i++) {
      const temp = i * (this.overlapLength - i);
      const context = i * 2;
      this.refMidBuffer[context] = this.midBuffer[context] * temp;
      this.refMidBuffer[context + 1] = this.midBuffer[context + 1] * temp;
    }
  }
  calculateCrossCorrelationStereo(mixingPosition, compare) {
    const mixing = this._inputBuffer.vector;
    mixingPosition += this._inputBuffer.startIndex;
    let correlation = 0;
    const calcLength = 2 * this.overlapLength;
    for (let i = 2; i < calcLength; i += 2) {
      const mixingOffset = i + mixingPosition;
      correlation += mixing[mixingOffset] * compare[i] + mixing[mixingOffset + 1] * compare[i + 1];
    }
    return correlation;
  }
  overlap(overlapPosition) { this.overlapStereo(2 * overlapPosition); }
  overlapStereo(inputPosition) {
    const input = this._inputBuffer.vector;
    inputPosition += this._inputBuffer.startIndex;
    const output = this._outputBuffer.vector;
    const outputPosition = this._outputBuffer.endIndex;
    const frameScale = 1 / this.overlapLength;
    for (let i = 0; i < this.overlapLength; i++) {
      const tempFrame = (this.overlapLength - i) * frameScale;
      const fi = i * frameScale;
      const context = 2 * i;
      const inputOffset = context + inputPosition;
      const outputOffset = context + outputPosition;
      output[outputOffset] = input[inputOffset] * fi + this.midBuffer[context] * tempFrame;
      output[outputOffset + 1] = input[inputOffset + 1] * fi + this.midBuffer[context + 1] * tempFrame;
    }
  }
  process() {
    if (this.midBuffer === null) {
      if (this._inputBuffer.frameCount < this.overlapLength) return;
      this.midBuffer = new Float32Array(this.overlapLength * 2);
      this._inputBuffer.receiveSamples(this.midBuffer, this.overlapLength);
    }
    while (this._inputBuffer.frameCount >= this.sampleReq) {
      const offset = this.seekBestOverlapPosition();
      this._outputBuffer.ensureAdditionalCapacity(this.overlapLength);
      this.overlap(Math.floor(offset));
      this._outputBuffer.put(this.overlapLength);
      const temp = this.seekWindowLength - 2 * this.overlapLength;
      if (temp > 0) this._outputBuffer.putBuffer(this._inputBuffer, offset + this.overlapLength, temp);
      const start = this._inputBuffer.startIndex + 2 * (offset + this.seekWindowLength - this.overlapLength);
      this.midBuffer.set(this._inputBuffer.vector.subarray(start, start + 2 * this.overlapLength));
      this.skipFract += this.nominalSkip;
      const overlapSkip = Math.floor(this.skipFract);
      this.skipFract -= overlapSkip;
      this._inputBuffer.receive(overlapSkip);
    }
  }
}

const testFloatEqual = (a, b) => (a > b ? a - b : b - a) > 1e-10;

class SoundTouch {
  constructor() {
    this.transposer = new RateTransposer(false);
    this.stretch = new Stretch(false);
    this._inputBuffer = new FifoSampleBuffer();
    this._intermediateBuffer = new FifoSampleBuffer();
    this._outputBuffer = new FifoSampleBuffer();
    this._rate = 0;
    this._tempo = 0;
    this.virtualPitch = 1.0;
    this.virtualRate = 1.0;
    this.virtualTempo = 1.0;
    this.calculateEffectiveRateAndTempo();
  }
  clear() { this.transposer.clear(); this.stretch.clear(); }
  get rate() { return this._rate; }
  set rate(rate) { this.virtualRate = rate; this.calculateEffectiveRateAndTempo(); }
  set rateChange(rc) { this._rate = 1.0 + 0.01 * rc; }
  get tempo() { return this._tempo; }
  set tempo(tempo) { this.virtualTempo = tempo; this.calculateEffectiveRateAndTempo(); }
  set tempoChange(tc) { this.tempo = 1.0 + 0.01 * tc; }
  set pitch(pitch) { this.virtualPitch = pitch; this.calculateEffectiveRateAndTempo(); }
  set pitchOctaves(po) { this.pitch = Math.exp(0.69314718056 * po); this.calculateEffectiveRateAndTempo(); }
  set pitchSemitones(ps) { this.pitchOctaves = ps / 12.0; }
  get inputBuffer() { return this._inputBuffer; }
  get outputBuffer() { return this._outputBuffer; }
  calculateEffectiveRateAndTempo() {
    const previousTempo = this._tempo;
    const previousRate = this._rate;
    this._tempo = this.virtualTempo / this.virtualPitch;
    this._rate = this.virtualRate * this.virtualPitch;
    if (testFloatEqual(this._tempo, previousTempo)) this.stretch.tempo = this._tempo;
    if (testFloatEqual(this._rate, previousRate)) this.transposer.rate = this._rate;
    if (this._rate > 1.0) {
      if (this._outputBuffer !== this.transposer.outputBuffer) {
        this.stretch.inputBuffer = this._inputBuffer;
        this.stretch.outputBuffer = this._intermediateBuffer;
        this.transposer.inputBuffer = this._intermediateBuffer;
        this.transposer.outputBuffer = this._outputBuffer;
      }
    } else {
      if (this._outputBuffer !== this.stretch.outputBuffer) {
        this.transposer.inputBuffer = this._inputBuffer;
        this.transposer.outputBuffer = this._intermediateBuffer;
        this.stretch.inputBuffer = this._intermediateBuffer;
        this.stretch.outputBuffer = this._outputBuffer;
      }
    }
  }
  process() {
    if (this._rate > 1.0) { this.stretch.process(); this.transposer.process(); }
    else { this.transposer.process(); this.stretch.process(); }
  }
}

// ─── AudioWorkletProcessor ───────────────────────────────────────────────────

class SoundTouchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.st = new SoundTouch();
    // Set correct sample rate for WSOLA sequence calculations
    this.st.stretch.setParameters(sampleRate, 0, 0, DEFAULT_OVERLAP_MS);
    this.pitchFactor = 1.0;
    this._inputScratch = new Float32Array(256 * 2);
    this._outputScratch = new Float32Array(256 * 2);

    this.port.onmessage = (e) => {
      if (e.data.pitchFactor !== undefined) {
        const pf = e.data.pitchFactor;
        if (Math.abs(pf - this.pitchFactor) > 0.0001) {
          this.pitchFactor = pf;
          // SoundTouch pitch setter takes a ratio (1.0 = no shift)
          this.st.pitch = pf;
        }
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    const n = input[0].length;
    const left = input[0];
    const right = input[1] || input[0];

    // Passthrough when no shift needed
    if (Math.abs(this.pitchFactor - 1.0) < 0.0005) {
      if (output[0]) output[0].set(left);
      if (output[1]) output[1].set(right);
      return true;
    }

    // Interleave stereo and push into SoundTouch
    if (this._inputScratch.length < n * 2) this._inputScratch = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      this._inputScratch[i * 2] = left[i];
      this._inputScratch[i * 2 + 1] = right[i];
    }
    this.st.inputBuffer.putSamples(this._inputScratch, 0, n);
    this.st.process();

    // Pull output
    if (this._outputScratch.length < n * 2) this._outputScratch = new Float32Array(n * 2);
    const available = this.st.outputBuffer.frameCount;
    const toRead = Math.min(n, available);

    if (toRead > 0) {
      this.st.outputBuffer.receiveSamples(this._outputScratch, toRead);
    }

    if (output[0]) {
      for (let i = 0; i < n; i++) output[0][i] = i < toRead ? this._outputScratch[i * 2] : 0;
    }
    if (output[1]) {
      for (let i = 0; i < n; i++) output[1][i] = i < toRead ? this._outputScratch[i * 2 + 1] : 0;
    }

    return true;
  }
}

registerProcessor('soundtouch-processor', SoundTouchProcessor);
