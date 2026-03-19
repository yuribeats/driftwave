import { ProcessingParams } from "./types";
import { generateImpulseResponse } from "./impulse-response";

export interface RenderInput {
  channelData: Float32Array[];
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  params: ProcessingParams;
}

/**
 * Granular pitch shift applied directly to sample data.
 * Two overlapping Hann-windowed grains, constant-power crossfade.
 */
function pitchShiftBuffer(
  channelData: Float32Array[],
  pitchFactor: number
): Float32Array[] {
  if (Math.abs(pitchFactor - 1.0) < 0.0005) return channelData;

  const numCh = channelData.length;
  const len = channelData[0].length;
  const grainSize = 2048;
  const halfGrain = grainSize / 2;

  // Pre-compute Hann window
  const win = new Float32Array(grainSize);
  for (let i = 0; i < grainSize; i++) {
    win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / grainSize));
  }

  const output: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) output.push(new Float32Array(len));

  // State for two read heads
  const rPos = [0, halfGrain];
  const rPhase = [0, halfGrain];

  for (let i = 0; i < len; i++) {
    for (let g = 0; g < 2; g++) {
      const rp = rPos[g];
      const idx = Math.floor(rp);
      const frac = rp - idx;
      const w = win[rPhase[g]];

      for (let c = 0; c < numCh; c++) {
        const data = channelData[c];
        const i0 = Math.max(0, Math.min(idx, len - 1));
        const i1 = Math.max(0, Math.min(idx + 1, len - 1));
        const s = data[i0] * (1 - frac) + data[i1] * frac;
        output[c][i] += s * w;
      }

      rPos[g] += pitchFactor;
      rPhase[g]++;

      if (rPhase[g] >= grainSize) {
        rPhase[g] = 0;
        rPos[g] = i - grainSize + 1;
        if (rPos[g] < 0) rPos[g] = 0;
      }
    }
  }

  return output;
}

export async function renderOffline(input: RenderInput): Promise<{
  channelData: Float32Array[];
  sampleRate: number;
  numberOfChannels: number;
  length: number;
}> {
  const { channelData, sampleRate, numberOfChannels, length, params } = input;

  const outputLength = Math.ceil((length / params.rate) * 1.0) +
    Math.ceil(params.reverbDuration * sampleRate);
  const offlineCtx = new OfflineAudioContext(
    numberOfChannels,
    outputLength,
    sampleRate
  );

  // Create source buffer
  const sourceBuffer = offlineCtx.createBuffer(
    numberOfChannels,
    length,
    sampleRate
  );
  for (let c = 0; c < numberOfChannels; c++) {
    sourceBuffer.getChannelData(c).set(channelData[c]);
  }

  const source = offlineCtx.createBufferSource();
  source.buffer = sourceBuffer;
  source.playbackRate.value = params.rate;

  // EQ chain
  const lowShelf = offlineCtx.createBiquadFilter();
  lowShelf.type = "lowshelf";
  lowShelf.frequency.value = 200;
  lowShelf.gain.value = params.eqLow;

  const peaking = offlineCtx.createBiquadFilter();
  peaking.type = "peaking";
  peaking.frequency.value = 2500;
  peaking.Q.value = 1.0;
  peaking.gain.value = params.eqMid;

  const highShelf = offlineCtx.createBiquadFilter();
  highShelf.type = "highshelf";
  highShelf.frequency.value = 8000;
  highShelf.gain.value = params.eqHigh;

  const bump = offlineCtx.createBiquadFilter();
  bump.type = "peaking";
  bump.frequency.value = params.eqBumpFreq;
  bump.Q.value = 1.5;
  bump.gain.value = params.eqBumpGain;

  // Saturation (waveshaper with tanh soft-clipping)
  const waveshaper = offlineCtx.createWaveShaper();
  const curveLen = 44100;
  const curve = new Float32Array(curveLen);
  for (let i = 0; i < curveLen; i++) {
    const x = (i * 2) / curveLen - 1;
    curve[i] = Math.tanh(x * params.satDrive);
  }
  waveshaper.curve = curve;
  waveshaper.oversample = "4x";

  const satFilter = offlineCtx.createBiquadFilter();
  satFilter.type = "lowpass";
  satFilter.frequency.value = params.satTone;
  satFilter.Q.value = 0.707;

  const satDry = offlineCtx.createGain();
  satDry.gain.value = 1 - params.satMix;

  const satWet = offlineCtx.createGain();
  satWet.gain.value = params.satMix;

  const satMerger = offlineCtx.createGain();
  satMerger.gain.value = 1;

  // Reverb
  const irData = generateImpulseResponse(
    sampleRate,
    params.reverbDuration,
    params.reverbDecay
  );
  const irBuffer = offlineCtx.createBuffer(2, irData[0].length, sampleRate);
  irBuffer.getChannelData(0).set(irData[0]);
  irBuffer.getChannelData(1).set(irData[1]);

  const convolver = offlineCtx.createConvolver();
  convolver.buffer = irBuffer;

  const dryGain = offlineCtx.createGain();
  dryGain.gain.value = 1 - params.reverbWet;

  const wetGain = offlineCtx.createGain();
  wetGain.gain.value = params.reverbWet;

  // Connect signal chain: source → EQ → saturation → reverb → output
  source.connect(lowShelf);
  lowShelf.connect(peaking);
  peaking.connect(highShelf);
  highShelf.connect(bump);

  // Saturation dry/wet
  bump.connect(satDry);
  bump.connect(waveshaper);
  waveshaper.connect(satFilter);
  satFilter.connect(satWet);
  satDry.connect(satMerger);
  satWet.connect(satMerger);

  // Reverb dry/wet
  satMerger.connect(dryGain);
  satMerger.connect(convolver);
  convolver.connect(wetGain);

  dryGain.connect(offlineCtx.destination);
  wetGain.connect(offlineCtx.destination);

  source.start(0);

  const rendered = await offlineCtx.startRendering();

  // Extract channel data
  let outputChannels: Float32Array[] = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    outputChannels.push(new Float32Array(rendered.getChannelData(c)));
  }

  // Apply pitch shift post-processing when unlinked and pitchFactor != 1
  if (!params.pitchSpeedLinked && Math.abs(params.pitchFactor - 1.0) > 0.0005) {
    // Compensate: playbackRate already shifted pitch by `rate`. We want pitchFactor.
    // Net shift needed: pitchFactor / rate
    const netShift = params.pitchFactor / params.rate;
    outputChannels = pitchShiftBuffer(outputChannels, netShift);
  }

  return {
    channelData: outputChannels,
    sampleRate: rendered.sampleRate,
    numberOfChannels: rendered.numberOfChannels,
    length: outputChannels[0].length,
  };
}
