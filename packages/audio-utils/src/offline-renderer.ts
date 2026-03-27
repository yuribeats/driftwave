import { ProcessingParams } from "./types";
import { generateImpulseResponse } from "./impulse-response";
import { SoundTouch, SimpleFilter } from "soundtouchjs";

export interface RenderInput {
  channelData: Float32Array[];
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  params: ProcessingParams;
}

/**
 * WSOLA pitch shift using SoundTouch.
 * Tempo stays at 1.0 (no duration change) — only pitch is shifted.
 */
function pitchShiftBuffer(
  channelData: Float32Array[],
  pitchFactor: number
): Float32Array[] {
  if (Math.abs(pitchFactor - 1.0) < 0.0005) return channelData;

  const numCh = channelData.length;
  const len = channelData[0].length;
  const left = channelData[0];
  const right = numCh > 1 ? channelData[1] : channelData[0];

  const st = new SoundTouch();
  st.pitch = pitchFactor;

  let readPos = 0;
  const source = {
    extract(target: Float32Array, numFrames: number): number {
      const available = len - readPos;
      const toRead = Math.min(numFrames, available);
      for (let i = 0; i < toRead; i++) {
        target[i * 2] = left[readPos + i];
        target[i * 2 + 1] = right[readPos + i];
      }
      readPos += toRead;
      return toRead;
    },
  };

  const filter = new SimpleFilter(source, st);
  const outLeft = new Float32Array(len);
  const outRight = new Float32Array(len);

  const CHUNK = 4096;
  const samples = new Float32Array(CHUNK * 2);
  let outPos = 0;

  while (outPos < len) {
    const extracted = filter.extract(samples, Math.min(CHUNK, len - outPos));
    if (extracted === 0) break;
    for (let i = 0; i < extracted; i++) {
      outLeft[outPos + i] = samples[i * 2];
      outRight[outPos + i] = samples[i * 2 + 1];
    }
    outPos += extracted;
  }

  if (numCh > 1) return [outLeft, outRight];
  return [outLeft];
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
  dryGain.gain.value = 1.0; // always full dry — reverb is additive

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

  // Apply pitch shift to match live playback.
  // Live always runs: netShift = pitchFactor / rate.
  // This compensates the pitch change introduced by playbackRate so that
  // only the desired pitchFactor offset is heard (identical in linked and unlinked).
  const netShift = params.pitchFactor / params.rate;
  if (Math.abs(netShift - 1.0) > 0.0005) {
    outputChannels = pitchShiftBuffer(outputChannels, netShift);
  }

  return {
    channelData: outputChannels,
    sampleRate: rendered.sampleRate,
    numberOfChannels: rendered.numberOfChannels,
    length: outputChannels[0].length,
  };
}
