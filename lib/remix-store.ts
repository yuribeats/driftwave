import { create } from "zustand";
import {
  SimpleParams,
  SIMPLE_DEFAULTS,
  expandParams,
  renderOffline,
  encodeWAV,
} from "@yuribeats/audio-utils";
import { BatchStyle, BATCH_PRESETS } from "./batch-presets";
import { decodeFile, decodeArrayBuffer } from "./file-decoder";
import { getAudioContext, ensurePitchWorklet, isPitchWorkletReady } from "./audio-context";

/* ─── Saturation curve ─── */
function makeSaturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const samples = 512;
  const buffer = new ArrayBuffer(samples * 4);
  const curve = new Float32Array(buffer);
  // Normalize so the output ceiling stays at 1.0 regardless of drive
  const norm = drive > 0 ? 1 / Math.tanh(drive) : 1;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * drive) * norm;
  }
  return curve;
}

/* ─── Impulse response ─── */
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function generateIR(ctx: AudioContext, duration: number, decay: number): AudioBuffer {
  const length = Math.ceil(ctx.sampleRate * duration);
  const ir = ctx.createBuffer(2, length, ctx.sampleRate);
  const seedBase = Math.round(duration * 1000) * 7919 + Math.round(decay * 1000) * 104729 + ctx.sampleRate;
  // Independent seeds per channel for stereo width
  const seeds = [seedBase, seedBase ^ 0x5A3C9F1B];
  for (let c = 0; c < 2; c++) {
    const data = ir.getChannelData(c);
    const rand = seededRandom(seeds[c]);
    let prev = 0;
    for (let i = 0; i < length; i++) {
      // Exponential decay — plate-style tight tail
      const env = Math.exp(-decay * 4 * i / length);
      const noise = rand() * 2 - 1;
      // First-order highpass differentiation: brightens the reverb (plate character)
      const sample = noise - prev * 0.82;
      prev = noise;
      data[i] = sample * env;
    }
  }
  return ir;
}

/* ─── Automation interpolation ─── */
function getAutomationValue(points: AutomationPoint[], time: number): number {
  if (points.length === 0) return 1;
  // Before first point: interpolate from 1.0 to first point
  if (time <= points[0].time) {
    // At or before the first point, ramp from unity
    return 1;
  }
  // After last point: return 1.0 (back to unity)
  if (time >= points[points.length - 1].time) return 1;
  for (let i = 0; i < points.length - 1; i++) {
    if (time >= points[i].time && time <= points[i + 1].time) {
      const t = (time - points[i].time) / (points[i + 1].time - points[i].time);
      return points[i].value + t * (points[i + 1].value - points[i].value);
    }
  }
  return 1;
}

/* ─── Crossfader math: center = both full, edges = one cuts ─── */
function getCrossfaderGains(cf: number): { a: number; b: number } {
  return {
    a: cf <= 0 ? 1 : 1 - cf,
    b: cf >= 0 ? 1 : 1 + cf,
  };
}

/* ─── Types ─── */
interface DeckNodes {
  source: AudioBufferSourceNode;
  pitchShifter: AudioWorkletNode | null;
  lowShelf: BiquadFilterNode;
  peaking: BiquadFilterNode;
  highShelf: BiquadFilterNode;
  bump: BiquadFilterNode;
  waveshaper: WaveShaperNode;
  satFilter: BiquadFilterNode;
  convolver: ConvolverNode;
  dryGain: GainNode;
  wetGain: GainNode;
  analyser: AnalyserNode;
  fadeGain: GainNode;
  deckGain: GainNode;
}

type StemType = "vocals" | "drums" | "bass" | "other";

interface BankedLoop {
  name: string;
  start: number;
  end: number;
}

interface AutomationPoint {
  time: number;   // seconds into source buffer
  value: number;  // 0–1 volume
}

interface DeckState {
  sourceBuffer: AudioBuffer | null;
  sourceFilename: string | null;
  sourceFile: File | null;
  sourceUrl: string | null;
  artist: string;
  title: string;
  baseKey: number | null;
  params: SimpleParams;
  isLoading: boolean;
  isPlaying: boolean;
  error: string | null;
  nodes: DeckNodes | null;
  startedAt: number;
  pauseOffset: number;
  volume: number;
  stemError: string | null;
  calculatedBPM: number | null;
  regionStart: number;  // seconds into source buffer
  regionEnd: number;    // seconds into source buffer (0 = full track)
  activeStem: StemType | null;
  stemBuffers: Partial<Record<StemType, AudioBuffer>> | null;
  isStemLoading: boolean;
  loopBank: BankedLoop[];
  automationEnabled: boolean;
  automationPoints: AutomationPoint[];
  gridlockEnabled: boolean;
  gridOffsetMs: number;
  gridFirstTransient: number;
  gridLockedSectionDur: number; // seconds — frozen at toggle-on
  firstDownbeatMs: number | null;
  downbeatDetecting: boolean;
}

type DeckId = "A" | "B";

const defaultDeck = (): DeckState => ({
  sourceBuffer: null,
  sourceFilename: null,
  sourceFile: null,
  sourceUrl: null,
  artist: "",
  title: "",
  baseKey: null,
  params: { ...SIMPLE_DEFAULTS, speed: 0, reverb: 0, tone: 0, saturation: 0, pitch: 0, pitchSpeedLinked: true },
  isLoading: false,
  isPlaying: false,
  error: null,
  nodes: null,
  startedAt: 0,
  pauseOffset: 0,
  volume: 0.6,
  stemError: null,
  calculatedBPM: null,
  regionStart: 0,
  regionEnd: 0,
  activeStem: null,
  stemBuffers: null,
  isStemLoading: false,
  loopBank: [],
  automationEnabled: false,
  automationPoints: [],
  gridlockEnabled: false,
  gridOffsetMs: 0,
  gridFirstTransient: 0,
  gridLockedSectionDur: 0,
  firstDownbeatMs: null,
  downbeatDetecting: false,
});

export interface MasterBusParams {
  eqLow: number;       // -20 to +20 dB
  eqMid: number;       // -20 to +20 dB
  eqHigh: number;      // -20 to +20 dB
  compAmount: number;   // 0–1 single knob
  // Compressor detail overrides
  compThreshold?: number;  // -60 to 0 dB
  compRatio?: number;      // 1 to 20
  compAttack?: number;     // 0.001 to 0.5 s
  compRelease?: number;    // 0.01 to 1 s
  compKnee?: number;       // 0 to 40 dB
  compMakeup?: number;     // 0 to 24 dB
  // Limiter
  limiterAmount: number;   // 0–1 single knob
  // Limiter detail overrides
  limiterThreshold?: number;  // -20 to 0 dB
  limiterRelease?: number;    // 0.001 to 0.3 s
  limiterKnee?: number;       // 0 to 6 dB
}

function expandCompressor(m: MasterBusParams) {
  const amt = m.compAmount;
  return {
    threshold: m.compThreshold ?? (amt * -40),
    ratio: m.compRatio ?? (1 + amt * 11),
    attack: m.compAttack ?? 0.01,
    release: m.compRelease ?? 0.15,
    knee: m.compKnee ?? 10,
    makeup: m.compMakeup ?? (amt * 12),
  };
}

function expandLimiter(m: MasterBusParams) {
  const amt = m.limiterAmount;
  return {
    threshold: m.limiterThreshold ?? (-0.5 - amt * 8), // -0.5 to -8.5 dB (gentler at low settings)
    ratio: 20,       // brick wall
    attack: 0.001,   // 1ms — fast attack
    release: m.limiterRelease ?? (0.08 + amt * 0.12), // slower release = more transparent, less pump
    knee: m.limiterKnee ?? (4 - amt * 4),             // soft knee at low settings, hard at high
  };
}

const defaultMasterBus: MasterBusParams = {
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  compAmount: 0,
  limiterAmount: 0,
};

interface RemixStore {
  deckA: DeckState;
  deckB: DeckState;
  crossfader: number;
  masterBus: MasterBusParams;

  bpmLocked: boolean;
  isExporting: boolean;
  recordArmed: boolean;
  isRecording: boolean;
  isConvertingWav: boolean;
  pendingRecording: Blob | null;
  pendingVideoExport: Blob | null;
  clearPendingRecording: () => void;
  clearPendingExport: () => void;
  downloadRecordingWAV: () => Promise<void>;
  exportRecordingMP4: () => void;

  // Sequencer
  sequencerOpen: boolean;
  sequencerTracksA: number[];  // indices into deckA.loopBank
  sequencerTracksB: number[];  // indices into deckB.loopBank
  sequencerPlaying: boolean;

  loadFile: (deck: DeckId, file: File) => Promise<void>;
  loadFromYouTube: (deck: DeckId, url: string) => Promise<void>;
  loadFromAudioUrl: (deck: DeckId, url: string, filename: string) => Promise<void>;
  setDeckMeta: (deck: DeckId, meta: { artist?: string; title?: string; baseKey?: number | null }) => void;
  restoreSession: (sessionId: string) => Promise<void>;
  restoreSessionFromData: (session: Record<string, unknown>) => Promise<void>;
  autoLoad: (artist: string, title: string) => Promise<void>;
  lookupEverysong: (deck: DeckId, artist: string, title: string) => Promise<void>;
  loadDeck: (deck: DeckId, artist: string, title: string) => Promise<void>;
  detectDownbeat: (deck: DeckId) => Promise<void>;
  play: (deck: DeckId, forceLoop?: boolean) => Promise<void>;
  stop: (deck: DeckId) => void;
  pause: (deck: DeckId) => void;
  setParam: (deck: DeckId, key: keyof SimpleParams, value: number | boolean) => void;
  setVolume: (deck: DeckId, volume: number) => void;
  setCrossfader: (value: number) => void;
  eject: (deck: DeckId) => void;
  setMasterBus: <K extends keyof MasterBusParams>(key: K, value: MasterBusParams[K]) => void;
  setStem: (deck: DeckId, stem: StemType | null) => void;
  separateStems: (deck: DeckId) => Promise<void>;
  setRegion: (deck: DeckId, start: number, end: number) => void;
  seek: (deck: DeckId, position: number) => Promise<void>;
  scrub: (deck: DeckId, position: number) => void;
  syncPlay: () => Promise<void>;
  calculateBPMFromLoop: (deck: DeckId) => void;
  addLoopToBank: (deck: DeckId) => void;
  removeFromBank: (deck: DeckId, index: number) => void;
  setSequencerOpen: (open: boolean) => void;
  addSequencerSlot: (deck: DeckId, bankIndex: number) => void;
  removeSequencerSlot: (deck: DeckId, slotIndex: number) => void;
  moveSequencerSlot: (deck: DeckId, fromIndex: number, toIndex: number) => void;
  clearSequencerTrack: (deck: DeckId) => void;
  playSequencer: () => Promise<void>;
  stopSequencer: () => void;
  lockBPM: () => void;
  applyStylePreset: (style: BatchStyle) => void;
  renderToBlob: () => Promise<Blob | null>;
  download: () => Promise<void>;
  exportMP4: () => Promise<void>;
  armRecord: () => void;
  stopRecording: () => void;
  setBPM: (deck: DeckId, bpm: number) => void;
  toggleAutomation: (deck: DeckId) => void;
  addAutomationPoint: (deck: DeckId, time: number, value: number) => void;
  removeAutomationPoint: (deck: DeckId, index: number) => void;
  moveAutomationPoint: (deck: DeckId, index: number, time: number, value: number) => void;
  toggleGridlock: (deck: DeckId) => void;
  setGridOffset: (deck: DeckId, ms: number) => void;
  lockGridSectionDur: (deck: DeckId) => void;
}

/* ─── Shared output bus: merger → EQ → compressor → makeup → limiter → destination ─── */
let sharedMerger: GainNode | null = null;
let masterLow: BiquadFilterNode | null = null;
let masterMid: BiquadFilterNode | null = null;
let masterHigh: BiquadFilterNode | null = null;
let masterComp: DynamicsCompressorNode | null = null;
let masterMakeup: GainNode | null = null;
let masterLimiter: DynamicsCompressorNode | null = null;
let masterStreamDest: MediaStreamAudioDestinationNode | null = null;
let masterAnalyser: AnalyserNode | null = null;

/* ─── Live recording state ─── */
let liveRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];

function getSharedMerger(): GainNode {
  const ctx = getAudioContext();
  if (!sharedMerger || sharedMerger.context !== ctx) {
    sharedMerger = ctx.createGain();

    masterLow = ctx.createBiquadFilter();
    masterLow.type = "lowshelf";
    masterLow.frequency.value = 200;
    masterLow.gain.value = 0;

    masterMid = ctx.createBiquadFilter();
    masterMid.type = "peaking";
    masterMid.frequency.value = 2500;
    masterMid.Q.value = 1.0;
    masterMid.gain.value = 0;

    masterHigh = ctx.createBiquadFilter();
    masterHigh.type = "highshelf";
    masterHigh.frequency.value = 8000;
    masterHigh.gain.value = 0;

    masterComp = ctx.createDynamicsCompressor();
    masterComp.threshold.value = 0;
    masterComp.ratio.value = 1;
    masterComp.attack.value = 0.01;
    masterComp.release.value = 0.15;
    masterComp.knee.value = 10;

    masterMakeup = ctx.createGain();
    masterMakeup.gain.value = 1;

    masterLimiter = ctx.createDynamicsCompressor();
    masterLimiter.threshold.value = 0;
    masterLimiter.ratio.value = 1;
    masterLimiter.attack.value = 0.001;
    masterLimiter.release.value = 0.01;
    masterLimiter.knee.value = 0;

    sharedMerger.connect(masterLow);
    masterLow.connect(masterMid);
    masterMid.connect(masterHigh);
    masterHigh.connect(masterComp);
    masterComp.connect(masterMakeup);
    masterMakeup.connect(masterLimiter);
    masterLimiter.connect(ctx.destination);

    masterStreamDest = ctx.createMediaStreamDestination();
    masterLimiter.connect(masterStreamDest);

    masterAnalyser = ctx.createAnalyser();
    masterAnalyser.fftSize = 256;
    masterAnalyser.smoothingTimeConstant = 0.85;
    masterLimiter.connect(masterAnalyser);
  }
  return sharedMerger;
}

export function getMasterAnalyser(): AnalyserNode | null {
  return masterAnalyser;
}

/* ─── Extract a region from an AudioBuffer as raw channel data ─── */
function extractRegion(buffer: AudioBuffer, start: number, end: number) {
  const sr = buffer.sampleRate;
  const s0 = Math.floor(start * sr);
  const s1 = Math.ceil(end * sr);
  const length = s1 - s0;
  const channelData: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channelData.push(buffer.getChannelData(c).slice(s0, s1));
  }
  return { channelData, sampleRate: sr, numberOfChannels: buffer.numberOfChannels, length };
}

/* ─── Build audio graph for a single deck ─── */
function buildDeckGraph(
  ctx: AudioContext,
  sourceBuffer: AudioBuffer,
  params: SimpleParams,
  offset: number,
  duration: number | undefined,
  volume: number,
  crossfaderGain: number,
  onEnded: () => void,
  loopRegion?: { loopStart: number; loopEnd: number },
  automationPoints?: AutomationPoint[],
): DeckNodes {
  const expanded = expandParams(params);

  const source = ctx.createBufferSource();
  source.buffer = sourceBuffer;
  source.playbackRate.value = expanded.rate;

  // EQ
  const lowShelf = ctx.createBiquadFilter();
  lowShelf.type = "lowshelf";
  lowShelf.frequency.value = 200;
  lowShelf.gain.value = expanded.eqLow;

  const peaking = ctx.createBiquadFilter();
  peaking.type = "peaking";
  peaking.frequency.value = 2500;
  peaking.Q.value = 0.5;
  peaking.gain.value = expanded.eqMid;

  const highShelf = ctx.createBiquadFilter();
  highShelf.type = "highshelf";
  highShelf.frequency.value = 8000;
  highShelf.gain.value = expanded.eqHigh;

  const bump = ctx.createBiquadFilter();
  bump.type = "peaking";
  bump.frequency.value = expanded.eqBumpFreq;
  bump.Q.value = 0.7;
  bump.gain.value = expanded.eqBumpGain;

  // Saturation — series routing (no dry/wet split avoids phase comb filtering)
  const waveshaper = ctx.createWaveShaper();
  waveshaper.curve = makeSaturationCurve(expanded.satDrive);
  waveshaper.oversample = "4x";

  const satFilter = ctx.createBiquadFilter();
  satFilter.type = "lowpass";
  satFilter.frequency.value = expanded.satTone;
  satFilter.Q.value = 0.707;

  // Reverb
  const convolver = ctx.createConvolver();
  convolver.buffer = generateIR(ctx, expanded.reverbDuration, expanded.reverbDecay);

  const dryGain = ctx.createGain();
  dryGain.gain.value = 1.0; // always full dry — reverb is additive

  const wetGain = ctx.createGain();
  wetGain.gain.value = expanded.reverbWet;

  const reverbMerger = ctx.createGain();

  // Analyser (pre-fader)
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;

  // Deck output gain (volume × crossfader)
  const deckGain = ctx.createGain();
  deckGain.gain.value = volume * crossfaderGain;

  // Automation gain (separate node so volume fader still works independently)
  // Line starts and ends at 1.0 (unity), points dip/boost in between
  const autoGain = ctx.createGain();
  if (automationPoints && automationPoints.length > 0) {
    const rate = expanded.rate;
    const now = ctx.currentTime;
    // Start at unity (or interpolated value if resuming mid-automation)
    const autoVal = getAutomationValue(automationPoints, offset);
    autoGain.gain.setValueAtTime(autoVal, now);
    // Ramp to first point from unity if we're before it
    if (offset < automationPoints[0].time) {
      const when = now + (automationPoints[0].time - offset) / rate;
      autoGain.gain.linearRampToValueAtTime(automationPoints[0].value, when);
    }
    // Schedule ramps between points
    for (let i = 0; i < automationPoints.length; i++) {
      if (automationPoints[i].time <= offset) continue;
      const when = now + (automationPoints[i].time - offset) / rate;
      autoGain.gain.linearRampToValueAtTime(automationPoints[i].value, when);
    }
    // Return to unity after last point
    const lastPt = automationPoints[automationPoints.length - 1];
    if (lastPt.time > offset) {
      const returnTime = now + (lastPt.time - offset) / rate;
      autoGain.gain.setValueAtTime(lastPt.value, returnTime);
      autoGain.gain.linearRampToValueAtTime(1.0, returnTime + 0.01);
    }
  }

  // Pitch shifter worklet — always present when worklet is ready
  let pitchShifter: AudioWorkletNode | null = null;
  if (isPitchWorkletReady()) {
    pitchShifter = new AudioWorkletNode(ctx, "rubberband-processor");
    const netShift = expanded.pitchFactor / expanded.rate;
    pitchShifter.port.postMessage(JSON.stringify(["pitch", netShift]));
  }

  // Connect: source → [pitchShifter?] → EQ → sat → reverb → analyser → deckGain → shared output
  if (pitchShifter) {
    source.connect(pitchShifter);
    pitchShifter.connect(lowShelf);
  } else {
    source.connect(lowShelf);
  }
  lowShelf.connect(peaking);
  peaking.connect(highShelf);
  highShelf.connect(bump);

  bump.connect(waveshaper);
  waveshaper.connect(satFilter);

  satFilter.connect(dryGain);
  satFilter.connect(convolver);
  convolver.connect(wetGain);
  dryGain.connect(reverbMerger);
  wetGain.connect(reverbMerger);

  // Fade-out gain node (scheduled to ramp to 0 over last 5 seconds of non-looping playback)
  const fadeGain = ctx.createGain();
  fadeGain.gain.value = 1.0;

  reverbMerger.connect(analyser);
  analyser.connect(autoGain);
  autoGain.connect(fadeGain);
  fadeGain.connect(deckGain);
  deckGain.connect(getSharedMerger());

  const safeOffset = Math.max(0, offset);
  source.onended = onEnded;
  if (loopRegion) {
    source.loop = true;
    source.loopStart = loopRegion.loopStart;
    source.loopEnd = loopRegion.loopEnd;
    source.start(0, safeOffset);
  } else if (duration && duration > 0) {
    source.start(0, safeOffset, duration);
    // Schedule 5-second fade out (wall-clock time = source duration / playback rate)
    const FADE_SECS = 5;
    const wallDuration = duration / expanded.rate;
    const now = ctx.currentTime;
    const fadeStart = now + Math.max(0, wallDuration - FADE_SECS);
    const fadeEnd = now + wallDuration;
    fadeGain.gain.setValueAtTime(1.0, fadeStart);
    fadeGain.gain.linearRampToValueAtTime(0, fadeEnd);
  } else {
    source.start(0, safeOffset);
  }

  return {
    source, pitchShifter, lowShelf, peaking, highShelf, bump,
    waveshaper, satFilter,
    convolver, dryGain, wetGain, analyser, fadeGain, deckGain,
  };
}

/* ─── Helper to get/set deck state ─── */
function getDeck(state: RemixStore, id: DeckId): DeckState {
  return id === "A" ? state.deckA : state.deckB;
}

function deckKey(id: DeckId): "deckA" | "deckB" {
  return id === "A" ? "deckA" : "deckB";
}

/* ─── Compact 16-bit PCM WAV for video export (much smaller than 32-bit float) ─── */
function encodeWAV16(rendered: AudioBuffer, targetSR: number): Blob {
  const nch = rendered.numberOfChannels;
  const srcSR = rendered.sampleRate;
  const ratio = srcSR / targetSR;
  const numSamples = Math.floor(rendered.length / ratio);
  const dataSize = numSamples * nch * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); w(8, "WAVE");
  w(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, nch, true); view.setUint32(24, targetSR, true);
  view.setUint32(28, targetSR * nch * 2, true); view.setUint16(32, nch * 2, true);
  view.setUint16(34, 16, true); w(36, "data"); view.setUint32(40, dataSize, true);
  let offset = 44;
  const channels: Float32Array[] = [];
  for (let c = 0; c < nch; c++) channels.push(rendered.getChannelData(c));
  for (let i = 0; i < numSamples; i++) {
    const srcIdx = i * ratio;
    const idx = Math.floor(srcIdx);
    const frac = srcIdx - idx;
    for (let c = 0; c < nch; c++) {
      const ch = channels[c];
      const s = idx + 1 < ch.length ? ch[idx] * (1 - frac) + ch[idx + 1] * frac : ch[idx];
      view.setInt16(offset, Math.max(-32768, Math.min(32767, Math.round(s * 32767))), true);
      offset += 2;
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}

/* ─── Offline render: mix both decks → master bus → normalized WAV ─── */
async function renderMixToWAV(get: () => RemixStore, forVideo = false): Promise<Blob | null> {
  const { deckA, deckB, crossfader, masterBus } = get();
  const hasA = !!deckA.sourceBuffer;
  const hasB = !!deckB.sourceBuffer;
  if (!hasA && !hasB) return null;

  const cfGains = getCrossfaderGains(crossfader);
  interface RenderResult {
    data: Float32Array[];
    gain: number;
    sr: number;
    nch: number;
    autoPoints: AutomationPoint[];
    rStart: number;
    rEnd: number;
    rate: number;
  }
  const renders: RenderResult[] = [];

  for (const [deck, cfGain] of [
    [deckA, cfGains.a],
    [deckB, cfGains.b],
  ] as [DeckState, number][]) {
    if (!deck.sourceBuffer) continue;

    const buf = (deck.activeStem && deck.stemBuffers?.[deck.activeStem]) || deck.sourceBuffer;
    const rStart = deck.regionStart;
    const rEnd = deck.regionEnd > 0 ? deck.regionEnd : buf.duration;
    const region = extractRegion(buf, rStart, rEnd);
    const expanded = expandParams(deck.params);

    const result = await renderOffline({
      ...region,
      params: expanded,
    });

    renders.push({
      data: result.channelData,
      gain: deck.volume * cfGain,
      sr: result.sampleRate,
      nch: result.numberOfChannels,
      autoPoints: deck.automationEnabled ? deck.automationPoints : [],
      rStart,
      rEnd,
      rate: expanded.rate,
    });
  }

  if (renders.length === 0) return null;

  const sr = renders[0].sr;
  const nch = Math.max(...renders.map((r) => r.nch));
  const maxLen = Math.max(...renders.map((r) => r.data[0].length));

  // Mix all renders together (with automation applied per-sample)
  // Shorter decks loop to fill the longer deck's duration
  const mixed: Float32Array[] = [];
  for (let c = 0; c < nch; c++) mixed.push(new Float32Array(maxLen));
  for (const r of renders) {
    const hasAuto = r.autoPoints.length > 0;
    const rLen = r.data[0].length;
    for (let c = 0; c < nch; c++) {
      const ch = c < r.data.length ? r.data[c] : r.data[0];
      for (let i = 0; i < maxLen; i++) {
        const si = i % rLen;
        let autoVal = 1;
        if (hasAuto) {
          const realTime = i / r.sr;
          const sourceTime = r.rStart + realTime * r.rate;
          autoVal = getAutomationValue(r.autoPoints, sourceTime);
        }
        mixed[c][i] += ch[si] * r.gain * autoVal;
      }
    }
  }

  // Apply master bus (EQ → compressor → makeup → limiter) via OfflineAudioContext
  const offCtx = new OfflineAudioContext(nch, maxLen, sr);
  const mixBuf = offCtx.createBuffer(nch, maxLen, sr);
  for (let c = 0; c < nch; c++) mixBuf.getChannelData(c).set(mixed[c]);

  const src = offCtx.createBufferSource();
  src.buffer = mixBuf;

  const mLow = offCtx.createBiquadFilter();
  mLow.type = "lowshelf"; mLow.frequency.value = 200; mLow.gain.value = masterBus.eqLow;
  const mMid = offCtx.createBiquadFilter();
  mMid.type = "peaking"; mMid.frequency.value = 2500; mMid.Q.value = 1.0; mMid.gain.value = masterBus.eqMid;
  const mHigh = offCtx.createBiquadFilter();
  mHigh.type = "highshelf"; mHigh.frequency.value = 8000; mHigh.gain.value = masterBus.eqHigh;

  const comp = expandCompressor(masterBus);
  const mComp = offCtx.createDynamicsCompressor();
  mComp.threshold.value = comp.threshold;
  mComp.ratio.value = comp.ratio;
  mComp.attack.value = comp.attack;
  mComp.release.value = comp.release;
  mComp.knee.value = comp.knee;

  const mMakeup = offCtx.createGain();
  mMakeup.gain.value = Math.pow(10, comp.makeup / 20);

  const lim = expandLimiter(masterBus);
  const mLim = offCtx.createDynamicsCompressor();
  mLim.threshold.value = lim.threshold;
  mLim.ratio.value = lim.ratio;
  mLim.attack.value = lim.attack;
  mLim.release.value = lim.release;
  mLim.knee.value = lim.knee;

  src.connect(mLow);
  mLow.connect(mMid);
  mMid.connect(mHigh);
  mHigh.connect(mComp);
  mComp.connect(mMakeup);
  mMakeup.connect(mLim);
  mLim.connect(offCtx.destination);

  src.start(0);
  const rendered = await offCtx.startRendering();

  // Normalize peaks
  let peak = 0;
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const ch = rendered.getChannelData(c);
    for (let i = 0; i < ch.length; i++) {
      const abs = Math.abs(ch[i]);
      if (abs > peak) peak = abs;
    }
  }
  if (peak > 1) {
    const scale = 0.99 / peak;
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const ch = rendered.getChannelData(c);
      for (let i = 0; i < ch.length; i++) ch[i] *= scale;
    }
  }

  // 5-second fade out at the end
  const fadeSamples = Math.min(rendered.sampleRate * 5, rendered.length);
  const fadeStart = rendered.length - fadeSamples;
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const ch = rendered.getChannelData(c);
    for (let i = 0; i < fadeSamples; i++) {
      ch[fadeStart + i] *= 1 - i / fadeSamples;
    }
  }

  // For video export: 16-bit 22050Hz (~8x smaller than 32-bit 44100Hz)
  // ffmpeg re-encodes to AAC anyway so full quality isn't needed
  if (forVideo) return encodeWAV16(rendered, 22050);
  return encodeWAV(rendered);
}

/* ─── Generation counters to prevent stale onEnded callbacks ─── */
const deckGeneration: Record<string, number> = { A: 0, B: 0 };

/* ─── Store ─── */
/* ─── Sequencer playback sources ─── */
let seqSourcesA: AudioBufferSourceNode[] = [];
let seqSourcesB: AudioBufferSourceNode[] = [];

export const useRemixStore = create<RemixStore>((set, get) => ({
  deckA: defaultDeck(),
  deckB: defaultDeck(),
  crossfader: 0,
  masterBus: { ...defaultMasterBus },
  bpmLocked: false,
  isExporting: false,
  recordArmed: false,
  isRecording: false,
  isConvertingWav: false,
  pendingRecording: null,
  pendingVideoExport: null,
  clearPendingRecording: () => set({ pendingRecording: null }),
  clearPendingExport: () => set({ pendingVideoExport: null }),

  downloadRecordingWAV: async () => {
    const { pendingRecording } = get();
    if (!pendingRecording) return;
    set({ isConvertingWav: true });
    try {
      const arrayBuf = await pendingRecording.arrayBuffer();
      const ctx = getAudioContext();
      const decoded = await ctx.decodeAudioData(arrayBuf);
      // Normalize if clipping
      let peak = 0;
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const ch = decoded.getChannelData(c);
        for (let i = 0; i < ch.length; i++) {
          const abs = Math.abs(ch[i]);
          if (abs > peak) peak = abs;
        }
      }
      if (peak > 1) {
        const scale = 0.99 / peak;
        for (let c = 0; c < decoded.numberOfChannels; c++) {
          const ch = decoded.getChannelData(c);
          for (let i = 0; i < ch.length; i++) ch[i] *= scale;
        }
      }
      const wavBlob = encodeWAV(decoded);
      const url = URL.createObjectURL(wavBlob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "driftwave-recording.wav";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("WAV conversion failed:", e);
    } finally {
      set({ isConvertingWav: false });
    }
  },

  exportRecordingMP4: () => {
    const { pendingRecording } = get();
    if (!pendingRecording) return;
    set({ pendingVideoExport: pendingRecording, pendingRecording: null });
  },
  sequencerOpen: false,
  sequencerTracksA: [],
  sequencerTracksB: [],
  sequencerPlaying: false,

  loadFile: async (id, file) => {
    const dk = deckKey(id);
    get().stop(id);
    set((s) => ({ [dk]: { ...s[dk], isLoading: true, pauseOffset: 0, calculatedBPM: null, activeStem: null, stemBuffers: null, stemError: null, sourceFile: file, sourceUrl: null } }));
    try {
      const audioBuffer = await decodeFile(file);
      set((s) => ({
        [dk]: {
          ...s[dk],
          sourceBuffer: audioBuffer,
          sourceFilename: file.name.replace(/\.[^/.]+$/, ""),
          isLoading: false,
          regionStart: 0,
          regionEnd: 0,
        },
      }));
    } catch {
      set((s) => ({ [dk]: { ...s[dk], isLoading: false } }));
    }
  },

  loadFromYouTube: async (id, url) => {
    const dk = deckKey(id);
    get().stop(id);
    set((s) => ({ [dk]: { ...s[dk], isLoading: true, error: null, pauseOffset: 0, calculatedBPM: null, activeStem: null, stemBuffers: null, stemError: null } }));
    try {
      const { fetchYouTubeAudio } = await import("./cobalt");
      const { buffer, title } = await fetchYouTubeAudio(url);
      const audioBuffer = await decodeArrayBuffer(buffer);
      set((s) => ({
        [dk]: {
          ...s[dk],
          sourceBuffer: audioBuffer,
          sourceFilename: title,
          sourceFile: null,
          sourceUrl: url,
          isLoading: false,
          regionStart: 0,
          regionEnd: 0,
        },
      }));
    } catch (err) {
      set((s) => ({ [dk]: { ...s[dk], isLoading: false, error: err instanceof Error ? err.message : "Failed to fetch YouTube audio" } }));
    }
  },

  setDeckMeta: (id, meta) => {
    const dk = deckKey(id);
    set((s) => ({ [dk]: { ...s[dk], ...meta } }));
  },

  loadFromAudioUrl: async (id, url, filename) => {
    if (url.includes("youtube.com") || url.includes("youtu.be")) {
      return get().loadFromYouTube(id, url);
    }
    const dk = deckKey(id);
    get().stop(id);
    set((s) => ({ [dk]: { ...s[dk], isLoading: true, sourceFilename: filename, sourceUrl: url, sourceFile: null } }));
    try {
      const res = await fetch(url);
      const ab = await res.arrayBuffer();
      const buffer = await decodeArrayBuffer(ab);
      set((s) => ({ [dk]: { ...s[dk], sourceBuffer: buffer, isLoading: false, regionStart: 0, regionEnd: 0 } }));
    } catch (err) {
      set((s) => ({ [dk]: { ...s[dk], isLoading: false, error: err instanceof Error ? err.message : "Load failed" } }));
    }
  },

  restoreSession: async (sessionId) => {
    try {
      const res = await fetch(`/api/session?id=${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const session = await res.json();
      if (session.error) return;

      const applyDeck = async (id: DeckId, d: Record<string, unknown> | null) => {
        if (!d?.audioUrl) return;
        await get().loadFromAudioUrl(id, d.audioUrl as string, (d.filename as string) || "shared-track");
        const params = (d.params as Record<string, unknown>) || {};
        for (const [k, v] of Object.entries(params)) {
          get().setParam(id, k as keyof SimpleParams, v as number | boolean);
        }
        get().setVolume(id, (d.volume as number) ?? 0.6);
        get().setRegion(id, (d.regionStart as number) ?? 0, (d.regionEnd as number) ?? 0);
        get().setDeckMeta(id, {
          artist: (d.artist as string) || "",
          title: (d.title as string) || "",
          baseKey: (d.baseKey as number | null) ?? null,
        });
        const dk = deckKey(id);
        if (d.calculatedBPM) {
          set((s) => ({ [dk]: { ...s[dk], calculatedBPM: d.calculatedBPM as number } }));
        }
        if (d.activeStem) {
          get().setStem(id, d.activeStem as StemType);
        }
      };

      await applyDeck("A", (session.deckA as Record<string, unknown>) ?? null);
      await applyDeck("B", (session.deckB as Record<string, unknown>) ?? null);
      if (typeof session.crossfader === "number") get().setCrossfader(session.crossfader);
    } catch (err) {
      console.error("restoreSession error:", err);
    }
  },

  restoreSessionFromData: async (session) => {
    try {
      const applyDeck = async (id: DeckId, d: Record<string, unknown> | null) => {
        if (!d?.audioUrl) return;
        await get().loadFromAudioUrl(id, d.audioUrl as string, (d.filename as string) || "track");
        const params = (d.params as Record<string, unknown>) || {};
        for (const [k, v] of Object.entries(params)) {
          get().setParam(id, k as keyof SimpleParams, v as number | boolean);
        }
        get().setVolume(id, (d.volume as number) ?? 0.6);
        get().setRegion(id, (d.regionStart as number) ?? 0, (d.regionEnd as number) ?? 0);
        get().setDeckMeta(id, {
          artist: (d.artist as string) || "",
          title: (d.title as string) || "",
          baseKey: (d.baseKey as number | null) ?? null,
        });
        if (d.calculatedBPM) {
          const dk = deckKey(id);
          set((s) => ({ [dk]: { ...s[dk], calculatedBPM: d.calculatedBPM as number } }));
        }
      };

      await applyDeck("A", (session.deckA as Record<string, unknown>) ?? null);
      await applyDeck("B", (session.deckB as Record<string, unknown>) ?? null);
      if (typeof session.crossfader === "number") get().setCrossfader(session.crossfader);

      if (session.masterBus && typeof session.masterBus === "object") {
        const mb = session.masterBus as Record<string, unknown>;
        for (const [k, v] of Object.entries(mb)) {
          get().setMasterBus(k as keyof MasterBusParams, v as number);
        }
      }
    } catch (err) {
      console.error("restoreSessionFromData error:", err);
    }
  },

  autoLoad: async (artist, title) => {
    const everysong = async (id: DeckId) => {
      const esRes = await fetch(`/api/everysong?q=${encodeURIComponent(`${artist} ${title}`)}`);
      const esData = await esRes.json();
      if (esData.found) {
        if (esData.bpm) get().setBPM(id, esData.bpm);
        if (esData.noteIndex !== null) get().setDeckMeta(id, { baseKey: esData.noteIndex });
      }
      get().setDeckMeta(id, { artist, title });
    };

    await Promise.all([
      // Deck A: instrumental
      (async () => {
        const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(`${artist} ${title} instrumental`)}`);
        const { url, error } = await res.json();
        if (error || !url) throw new Error(error || "No results for instrumental");
        await get().loadFromYouTube("A", url);
        // Everysong first so BPM+key priors are in store before detectDownbeat reads them
        await everysong("A");
        await get().detectDownbeat("A");
      })(),

      // Deck B: full track → detect downbeat on full mix → stem isolation → vocals
      (async () => {
        const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(`${artist} ${title}`)}`);
        const { url, error } = await res.json();
        if (error || !url) throw new Error(error || "No results");
        await get().loadFromYouTube("B", url);
        // Everysong first so BPM+key priors are in store before detectDownbeat reads them
        await everysong("B");
        // Detect downbeat on full mix BEFORE isolation (full mix has drums → most accurate)
        await get().detectDownbeat("B");
        // Isolate vocals; downbeat timestamp carries over (timing unchanged by Demucs)
        await get().separateStems("B");
        get().setStem("B", "vocals");
      })(),
    ]);
  },

  lookupEverysong: async (id, artist, title) => {
    if (!artist && !title) return;
    const q = encodeURIComponent(`${artist} ${title}`);
    console.log(`[lookupEverysong:${id}] querying Everysong for "${artist} ${title}"`);
    try {
      const res = await fetch(`/api/everysong?q=${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log(`[lookupEverysong:${id}] response:`, data);
      if (data.found) {
        if (data.bpm) {
          console.log(`[lookupEverysong:${id}] setting BPM = ${data.bpm}`);
          get().setBPM(id, data.bpm);
        }
        if (data.noteIndex !== null && data.noteIndex !== undefined) {
          console.log(`[lookupEverysong:${id}] setting key = noteIndex ${data.noteIndex} (${data.key})`);
          get().setDeckMeta(id, { baseKey: data.noteIndex });
        }
      } else {
        console.warn(`[lookupEverysong:${id}] no match found for "${artist} ${title}"`);
      }
    } catch (e) {
      console.error(`[lookupEverysong:${id}] error:`, e);
    }
    get().setDeckMeta(id, { artist, title });
  },

  loadDeck: async (id, artist, title) => {
    const searchQuery = id === "A" ? `${artist} ${title} instrumental` : `${artist} ${title}`;
    console.log(`[loadDeck:${id}] starting — searching YouTube for "${searchQuery}"`);

    const searchQ = encodeURIComponent(searchQuery);
    let url: string;
    try {
      const res = await fetch(`/api/youtube/search?q=${searchQ}`);
      if (!res.ok) throw new Error(`YouTube search HTTP ${res.status}`);
      const data = await res.json();
      if (data.error || !data.url) throw new Error(data.error || "No YouTube results");
      url = data.url;
      console.log(`[loadDeck:${id}] found URL: ${url}`);
    } catch (e) {
      console.error(`[loadDeck:${id}] YouTube search failed:`, e);
      throw e;
    }

    try {
      console.log(`[loadDeck:${id}] loading audio from YouTube`);
      await get().loadFromYouTube(id, url);
      console.log(`[loadDeck:${id}] audio loaded`);
    } catch (e) {
      console.error(`[loadDeck:${id}] loadFromYouTube failed:`, e);
      throw e;
    }

    console.log(`[loadDeck:${id}] running Everysong lookup`);
    await get().lookupEverysong(id, artist, title);

    console.log(`[loadDeck:${id}] running downbeat detection`);
    await get().detectDownbeat(id);

    // Set IN point to ML-detected downbeat + enable gridlock anchored there
    const dk = deckKey(id);
    const updated = getDeck(get(), id);
    if (updated.firstDownbeatMs !== null) {
      const inPoint = updated.firstDownbeatMs / 1000;
      console.log(`[loadDeck:${id}] downbeat at ${inPoint.toFixed(3)}s — setting IN point + enabling gridlock`);
      get().setRegion(id, inPoint, 0);
      const currentRate = 1.0 + updated.params.speed;
      const lockedDur = updated.calculatedBPM ? 960 / (updated.calculatedBPM * currentRate) : 0;
      console.log(`[loadDeck:${id}] gridlock: firstTransient=${inPoint.toFixed(3)}s, lockedDur=${lockedDur.toFixed(3)}s, BPM=${updated.calculatedBPM}`);
      set((s) => ({
        [dk]: {
          ...s[dk],
          gridlockEnabled: true,
          gridFirstTransient: inPoint,
          gridLockedSectionDur: lockedDur,
          gridOffsetMs: 0,
        },
      }));
    } else {
      console.warn(`[loadDeck:${id}] no downbeat detected — IN point not moved, gridlock not enabled`);
    }

    if (id === "B") {
      console.log(`[loadDeck:B] starting stem isolation`);
      try {
        await get().separateStems(id);
        get().setStem(id, "vocals");
        console.log(`[loadDeck:B] vocals stem active`);
      } catch (e) {
        console.error(`[loadDeck:B] stem separation failed:`, e);
        throw e;
      }
    }

    console.log(`[loadDeck:${id}] complete`);
  },

  detectDownbeat: async (id) => {
    const dk = deckKey(id);
    const deck = getDeck(get(), id);
    if (!deck.sourceBuffer) {
      console.warn(`[detectDownbeat:${id}] no source buffer — skipping`);
      return;
    }

    set((s) => ({ [dk]: { ...s[dk], downbeatDetecting: true } }));

    try {
      // Pass confirmed BPM and key from Everysong as priors to constrain the DBN
      const rate = 1.0 + deck.params.speed;
      const confirmedBpm = deck.calculatedBPM ? deck.calculatedBPM * rate : null;
      const priors: Record<string, unknown> = {};
      if (confirmedBpm) priors.bpm = confirmedBpm;
      if (deck.baseKey !== null) priors.note_index = deck.baseKey;

      console.log(`[detectDownbeat:${id}] priors:`, { confirmedBpm, note_index: deck.baseKey, sourceUrl: deck.sourceUrl });

      let res: Response;
      if (deck.sourceUrl) {
        console.log(`[detectDownbeat:${id}] sending YouTube URL to /api/downbeat`);
        res = await fetch("/api/downbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ youtubeUrl: deck.sourceUrl, ...priors }),
        });
      } else if (deck.sourceFile) {
        console.log(`[detectDownbeat:${id}] uploading local file to /api/downbeat`);
        const fd = new FormData();
        fd.append("audio", deck.sourceFile);
        if (confirmedBpm) fd.append("bpm", String(confirmedBpm));
        if (deck.baseKey !== null) fd.append("note_index", String(deck.baseKey));
        res = await fetch("/api/downbeat", { method: "POST", body: fd });
      } else {
        const url = deck.sourceFilename;
        if (!url) {
          console.warn(`[detectDownbeat:${id}] no sourceUrl, sourceFile, or filename — cannot detect`);
          set((s) => ({ [dk]: { ...s[dk], downbeatDetecting: false } }));
          return;
        }
        console.log(`[detectDownbeat:${id}] sending audio URL to /api/downbeat: ${url}`);
        res = await fetch("/api/downbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioUrl: url, ...priors }),
        });
      }

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[detectDownbeat:${id}] /api/downbeat HTTP ${res.status}: ${errText}`);
        set((s) => ({ [dk]: { ...s[dk], downbeatDetecting: false } }));
        return;
      }

      const data = await res.json();
      console.log(`[detectDownbeat:${id}] response:`, data);

      if (data.error) {
        console.error(`[detectDownbeat:${id}] Modal error: ${data.error}`);
        set((s) => ({ [dk]: { ...s[dk], downbeatDetecting: false } }));
        return;
      }

      if (data.first_downbeat_ms !== null && data.first_downbeat_ms !== undefined) {
        const firstDownbeatMs = data.first_downbeat_ms as number;
        console.log(`[detectDownbeat:${id}] first downbeat = ${firstDownbeatMs}ms (${(firstDownbeatMs/1000).toFixed(3)}s), BPM=${data.bpm}, beats=${data.beats_ms?.length}`);
        set((s) => ({
          [dk]: {
            ...s[dk],
            firstDownbeatMs,
            downbeatDetecting: false,
            // Feed into gridFirstTransient so gridlock syncs from the actual musical downbeat
            gridFirstTransient: firstDownbeatMs / 1000,
          },
        }));
        // Apply ML-detected BPM and key if Everysong hasn't already populated them
        const updated = getDeck(get(), id);
        if (data.bpm && !updated.calculatedBPM) {
          console.log(`[detectDownbeat:${id}] applying ML BPM = ${data.bpm} (Everysong not available)`);
          get().setBPM(id, data.bpm);
        }
        if (data.note_index !== null && data.note_index !== undefined && updated.baseKey === null) {
          console.log(`[detectDownbeat:${id}] applying ML key = noteIndex ${data.note_index}`);
          get().setDeckMeta(id, { baseKey: data.note_index });
        }
      } else {
        console.warn(`[detectDownbeat:${id}] no downbeat returned from Modal`);
        set((s) => ({ [dk]: { ...s[dk], downbeatDetecting: false } }));
      }
    } catch (e) {
      console.error(`[detectDownbeat:${id}] unexpected error:`, e);
      set((s) => ({ [dk]: { ...s[dk], downbeatDetecting: false } }));
    }
  },

  play: async (id, forceLoop) => {
    const key = deckKey(id);
    const deck = getDeck(get(), id);
    if (!deck.sourceBuffer) return;

    // Bump generation — any previous onEnded callback becomes stale
    deckGeneration[id] = (deckGeneration[id] || 0) + 1;
    const gen = deckGeneration[id];

    // Kill existing source
    if (deck.nodes) {
      try { deck.nodes.source.onended = null; } catch { /* ok */ }
      try { deck.nodes.source.stop(); } catch { /* ok */ }
    }
    set((s) => ({ [key]: { ...s[key], isPlaying: false, nodes: null } }));

    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    await ensurePitchWorklet();

    // Re-read deck state after async gap
    const freshDeck = getDeck(get(), id);
    if (!freshDeck.sourceBuffer) return;

    const cfGains = getCrossfaderGains(get().crossfader);
    const cfGain = id === "A" ? cfGains.a : cfGains.b;

    const playBuffer = (freshDeck.activeStem && freshDeck.stemBuffers?.[freshDeck.activeStem]) || freshDeck.sourceBuffer;

    const rStart = freshDeck.regionStart;
    const rEnd = freshDeck.regionEnd > 0 ? freshDeck.regionEnd : playBuffer.duration;
    const hasRegion = rStart > 0 || (freshDeck.regionEnd > 0 && freshDeck.regionEnd < playBuffer.duration);
    const shouldLoop = hasRegion || !!forceLoop;
    const playOffset = freshDeck.pauseOffset >= rStart ? freshDeck.pauseOffset : rStart;
    const remaining = rEnd - playOffset;
    const playDuration = remaining > 0 ? remaining : undefined;

    const nodes = buildDeckGraph(
      ctx,
      playBuffer,
      freshDeck.params,
      playOffset,
      shouldLoop ? undefined : playDuration,
      freshDeck.volume,
      cfGain,
      () => {
        // Only fires for non-looping playback (native loop never triggers onEnded)
        if (deckGeneration[id] !== gen) return;
        if (!getDeck(get(), id).isPlaying) return;
        set((s) => ({
          [key]: { ...s[key], isPlaying: false, nodes: null, pauseOffset: rStart },
        }));
      },
      shouldLoop ? { loopStart: rStart, loopEnd: rEnd } : undefined,
      freshDeck.automationEnabled ? freshDeck.automationPoints : undefined,
    );

    set((s) => ({
      [key]: {
        ...s[key],
        isPlaying: true,
        nodes,
        startedAt: ctx.currentTime - (playOffset - rStart) / expandParams(freshDeck.params).rate,
      },
    }));
  },

  stop: (id) => {
    const key = deckKey(id);
    const deck = getDeck(get(), id);
    // Bump generation first so onEnded is ignored
    deckGeneration[id] = (deckGeneration[id] || 0) + 1;
    // Set state before stopping source (onEnded will check generation and bail)
    set((s) => ({
      [key]: { ...s[key], pauseOffset: s[key].regionStart, isPlaying: false, nodes: null },
    }));
    if (deck.nodes) {
      try { deck.nodes.source.onended = null; } catch { /* ok */ }
      try { deck.nodes.source.stop(); } catch { /* ok */ }
    }

  },

  pause: (id) => {
    const key = deckKey(id);
    const deck = getDeck(get(), id);
    if (!deck.nodes || !deck.isPlaying) return;
    // Bump generation first
    deckGeneration[id] = (deckGeneration[id] || 0) + 1;
    const ctx = getAudioContext();
    const rStart = deck.regionStart;
    const elapsed = rStart + (ctx.currentTime - deck.startedAt) * expandParams(deck.params).rate;
    // Set state before stopping source
    set((s) => ({
      [key]: { ...s[key], pauseOffset: elapsed, isPlaying: false, nodes: null },
    }));
    try { deck.nodes.source.onended = null; } catch { /* ok */ }
    try { deck.nodes.source.stop(); } catch { /* ok */ }
  },

  setParam: (id, paramKey, value) => {
    const key = deckKey(id);

    // In linked mode, speed and pitch always move together.
    // Build a single atomic state update so expanded params are always consistent.
    const currentLinked = getDeck(get(), id).params.pitchSpeedLinked ?? true;
    const extraParams: Partial<SimpleParams> = {};
    if (paramKey === "speed" && currentLinked) {
      extraParams.pitch = 12 * Math.log2(1 + Number(value));
    }

    set((s) => ({
      [key]: {
        ...s[key],
        params: { ...s[key].params, [paramKey]: value, ...extraParams },
      },
    }));

    const deck = getDeck(get(), id);
    if (!deck.nodes) return;

    const expanded = expandParams(deck.params);

    if (paramKey === "speed") {
      deck.nodes.source.playbackRate.value = expanded.rate;
    }

    // Update pitch shifter compensation when speed or pitch changes
    if (deck.nodes.pitchShifter && (paramKey === "speed" || paramKey === "pitch")) {
      const netShift = expanded.pitchFactor / expanded.rate;
      deck.nodes.pitchShifter.port.postMessage(JSON.stringify(["pitch", netShift]));
    }

    const toneKeys: (keyof SimpleParams)[] = ["tone", "eqLowOverride", "eqMidOverride", "eqHighOverride", "eqBumpFreqOverride", "eqBumpGainOverride"];
    if (toneKeys.includes(paramKey)) {
      deck.nodes.lowShelf.gain.value = expanded.eqLow;
      deck.nodes.peaking.gain.value = expanded.eqMid;
      deck.nodes.highShelf.gain.value = expanded.eqHigh;
      deck.nodes.bump.frequency.value = expanded.eqBumpFreq;
      deck.nodes.bump.gain.value = expanded.eqBumpGain;
    }

    const reverbKeys: (keyof SimpleParams)[] = ["reverb", "reverbWetOverride", "reverbDurationOverride", "reverbDecayOverride"];
    if (reverbKeys.includes(paramKey)) {
      deck.nodes.dryGain.gain.value = 1.0; // always full dry — reverb is additive
      deck.nodes.wetGain.gain.value = expanded.reverbWet;
      const ctx = getAudioContext();
      deck.nodes.convolver.buffer = generateIR(ctx, expanded.reverbDuration, expanded.reverbDecay);
    }

    const satKeys: (keyof SimpleParams)[] = ["saturation", "satDriveOverride", "satMixOverride", "satToneOverride"];
    if (satKeys.includes(paramKey)) {
      deck.nodes.waveshaper.curve = makeSaturationCurve(expanded.satDrive);
      deck.nodes.satFilter.frequency.value = expanded.satTone;
    }

    // BPM lock: Deck A speed/pitch changes propagate to Deck B
    if (id === "A" && get().bpmLocked && (paramKey === "speed" || paramKey === "pitch")) {
      const { deckA, deckB } = get();
      if (deckA.sourceBuffer && deckB.sourceBuffer) {
        const loopA = (deckA.regionEnd > 0 ? deckA.regionEnd : deckA.sourceBuffer.duration) - deckA.regionStart;
        const loopB = (deckB.regionEnd > 0 ? deckB.regionEnd : deckB.sourceBuffer.duration) - deckB.regionStart;
        if (loopA > 0 && loopB > 0) {
          const rateA = 1.0 + deckA.params.speed;
          const newRateB = (loopB / loopA) * rateA;
          const newSpeedB = Math.max(-0.5, Math.min(0.5, newRateB - 1.0));

          // Set B's speed to match A's BPM
          const bKey = deckKey("B");
          set((s) => ({
            [bKey]: { ...s[bKey], params: { ...s[bKey].params, speed: newSpeedB } },
          }));
          const deckBFresh = getDeck(get(), "B");
          if (deckBFresh.nodes) {
            deckBFresh.nodes.source.playbackRate.value = 1.0 + newSpeedB;
            if (deckBFresh.nodes.pitchShifter) {
              const expB = expandParams(deckBFresh.params);
              deckBFresh.nodes.pitchShifter.port.postMessage(JSON.stringify(["pitch", expB.pitchFactor / expB.rate]));
            }
          }

          // If A changed pitch and B is linked, match pitch too
          if (paramKey === "pitch" && (deckBFresh.params.pitchSpeedLinked ?? true)) {
            set((s) => ({
              [bKey]: { ...s[bKey], params: { ...s[bKey].params, pitch: 12 * Math.log2(1.0 + newSpeedB) } },
            }));
          }
        }
      }
    }
  },

  setVolume: (id, volume) => {
    const key = deckKey(id);
    set((s) => ({ [key]: { ...s[key], volume } }));

    const deck = getDeck(get(), id);
    if (!deck.nodes) return;

    const cfGains = getCrossfaderGains(get().crossfader);
    const cfGain = id === "A" ? cfGains.a : cfGains.b;
    deck.nodes.deckGain.gain.value = volume * cfGain;
  },

  setCrossfader: (value) => {
    set({ crossfader: value });
    const { deckA, deckB } = get();
    const cfGains = getCrossfaderGains(value);

    if (deckA.nodes) {
      deckA.nodes.deckGain.gain.value = deckA.volume * cfGains.a;
    }
    if (deckB.nodes) {
      deckB.nodes.deckGain.gain.value = deckB.volume * cfGains.b;
    }
  },

  eject: (id) => {
    const key = deckKey(id);
    get().stop(id);
    set(() => ({
      [key]: {
        ...defaultDeck(),
      },
    }));
  },

  setRegion: (id, start, end) => {
    const dk = deckKey(id);
    set((s) => ({ [dk]: { ...s[dk], regionStart: start, regionEnd: end, pauseOffset: start } }));

    // Update live source node loop boundaries
    const deck = getDeck(get(), id);
    if (deck.nodes?.source && deck.isPlaying) {
      deck.nodes.source.loopStart = start;
      deck.nodes.source.loopEnd = end > 0 ? end : (deck.sourceBuffer?.duration ?? 0);
    }
  },

  seek: async (id, position) => {
    const dk = deckKey(id);
    const deck = getDeck(get(), id);
    if (!deck.sourceBuffer) return;
    const wasPlaying = deck.isPlaying;
    if (wasPlaying) get().pause(id);
    set((s) => ({ [dk]: { ...s[dk], pauseOffset: position } }));
    if (wasPlaying) await get().play(id);
  },

  scrub: (id, position) => {
    const dk = deckKey(id);
    set((s) => ({ [dk]: { ...s[dk], pauseOffset: position } }));
  },

  syncPlay: async () => {
    const { deckA, deckB, recordArmed } = get();
    const hasA = !!deckA.sourceBuffer;
    const hasB = !!deckB.sourceBuffer;
    if (!hasA && !hasB) return;

    // Stop both first
    if (hasA) get().stop("A");
    if (hasB) get().stop("B");

    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();

    // Start recording if armed
    if (recordArmed && masterStreamDest) {
      getSharedMerger(); // ensure bus is built
      recordedChunks = [];
      liveRecorder = new MediaRecorder(masterStreamDest.stream);
      liveRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };
      liveRecorder.start();
      set({ isRecording: true, recordArmed: false });
    }

    // Start both — play() is async but the actual source.start() inside
    // happens on the same AudioContext so they'll be sample-aligned
    // Force looping when recording so both tracks play for the full duration
    const loop = get().isRecording;
    if (hasA) get().play("A", loop);
    if (hasB) get().play("B", loop);
  },

  calculateBPMFromLoop: (id) => {
    const dk = deckKey(id);
    const deck = getDeck(get(), id);
    if (!deck.sourceBuffer) return;
    const rEnd = deck.regionEnd > 0 ? deck.regionEnd : deck.sourceBuffer.duration;
    const loopLength = rEnd - deck.regionStart;
    if (loopLength <= 0) return;
    // 4 bars: BPM = 240 / loopLength (no rounding — precision matters for lock)
    const bpm = 240 / loopLength;
    set((s) => ({ [dk]: { ...s[dk], calculatedBPM: bpm } }));
  },

  setBPM: (id, bpm) => {
    const dk = deckKey(id);
    const deck = getDeck(get(), id);
    if (!deck.sourceBuffer || bpm <= 0) return;
    // Store the base BPM at current speed — so calculatedBPM is the "original" BPM
    const rate = 1.0 + deck.params.speed;
    set((s) => ({ [dk]: { ...s[dk], calculatedBPM: bpm / rate } }));
  },

  setStem: (id, stem) => {
    const dk = deckKey(id);
    const deck = getDeck(get(), id);

    // Toggle off
    if (!stem || deck.activeStem === stem) {
      const wasPlaying = deck.isPlaying;
      if (wasPlaying) get().pause(id);
      set((s) => ({ [dk]: { ...s[dk], activeStem: null, stemError: null } }));
      if (wasPlaying) get().play(id);
      return;
    }

    // If stems aren't loaded yet, trigger separation
    if (!deck.stemBuffers) {
      set((s) => ({ [dk]: { ...s[dk], activeStem: stem, stemError: null } }));
      get().separateStems(id);
      return;
    }

    // Switch to stem — keep current position
    const wasPlaying = deck.isPlaying;
    if (wasPlaying) get().pause(id);
    set((s) => ({ [dk]: { ...s[dk], activeStem: stem, stemError: null } }));
    if (wasPlaying) get().play(id);
  },

  separateStems: async (id) => {
    const dk = deckKey(id);
    const deck = getDeck(get(), id);
    if ((!deck.sourceFile && !deck.sourceBuffer) || deck.isStemLoading) return;

    const wasPlaying = deck.isPlaying;
    if (wasPlaying) get().pause(id);

    set((s) => ({ [dk]: { ...s[dk], isStemLoading: true, stemError: null } }));

    try {
      let res: Response;
      if (deck.sourceUrl) {
        // YouTube — server re-downloads and uploads to Replicate directly
        res = await fetch("/api/stems", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ youtubeUrl: deck.sourceUrl }),
        });
      } else if (deck.sourceFile) {
        // Local file
        const formData = new FormData();
        formData.append("audio", deck.sourceFile, (deck.sourceFilename || "audio") + ".mp3");
        res = await fetch("/api/stems", { method: "POST", body: formData });
      } else {
        throw new Error("No audio source available");
      }

      if (!res.ok) {
        let msg = "Stem separation failed";
        try {
          const text = await res.text();
          try { const d = JSON.parse(text); msg = d.error || msg; } catch { msg = text.slice(0, 200) || msg; }
        } catch { /* ok */ }
        throw new Error(msg);
      }

      const data = await res.json();
      const ctx = getAudioContext();

      // Fetch and decode each stem audio from Replicate CDN
      const stemNames = ["vocals", "drums", "bass", "other"] as const;
      const stems: Partial<Record<StemType, AudioBuffer>> = {};

      await Promise.all(
        stemNames.map(async (name) => {
          const url = data[name];
          if (!url) return;
          const audioRes = await fetch(url);
          const arrayBuf = await audioRes.arrayBuffer();
          const audioBuf = await ctx.decodeAudioData(arrayBuf);
          stems[name] = audioBuf;
        })
      );

      set((s) => ({
        [dk]: { ...s[dk], stemBuffers: stems, isStemLoading: false },
      }));

      // Restart playback with the selected stem
      const freshDeck = getDeck(get(), id);
      if (freshDeck.activeStem) {
        get().play(id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stem separation failed";
      console.error("[stems] Error:", msg);
      set((s) => ({ [dk]: { ...s[dk], isStemLoading: false, stemError: msg, activeStem: null } }));
    }
  },

  setMasterBus: (key, value) => {
    set((s) => ({
      masterBus: { ...s.masterBus, [key]: value },
    }));

    const mb = get().masterBus;

    // Update EQ nodes
    if (key === "eqLow" && masterLow) masterLow.gain.value = mb.eqLow;
    if (key === "eqMid" && masterMid) masterMid.gain.value = mb.eqMid;
    if (key === "eqHigh" && masterHigh) masterHigh.gain.value = mb.eqHigh;

    // Update compressor
    const compKeys = ["compAmount", "compThreshold", "compRatio", "compAttack", "compRelease", "compKnee", "compMakeup"];
    if (compKeys.includes(key as string) && masterComp && masterMakeup) {
      const comp = expandCompressor(mb);
      masterComp.threshold.value = comp.threshold;
      masterComp.ratio.value = comp.ratio;
      masterComp.attack.value = comp.attack;
      masterComp.release.value = comp.release;
      masterComp.knee.value = comp.knee;
      masterMakeup.gain.value = Math.pow(10, comp.makeup / 20); // dB to linear
    }

    // Update limiter
    const limKeys = ["limiterAmount", "limiterThreshold", "limiterRelease", "limiterKnee"];
    if (limKeys.includes(key as string) && masterLimiter) {
      const lim = expandLimiter(mb);
      masterLimiter.threshold.value = lim.threshold;
      masterLimiter.ratio.value = lim.ratio;
      masterLimiter.attack.value = lim.attack;
      masterLimiter.release.value = lim.release;
      masterLimiter.knee.value = lim.knee;
    }
  },

  addLoopToBank: (id) => {
    const dk = deckKey(id);
    const deck = getDeck(get(), id);
    if (!deck.sourceBuffer) return;
    const rEnd = deck.regionEnd > 0 ? deck.regionEnd : deck.sourceBuffer.duration;
    if (deck.regionStart >= rEnd) return;
    const name = `LOOP ${deck.loopBank.length + 1}`;
    const loop: BankedLoop = { name, start: deck.regionStart, end: rEnd };
    set((s) => ({
      [dk]: { ...s[dk], loopBank: [...s[dk].loopBank, loop] },
    }));
  },

  removeFromBank: (id, index) => {
    const dk = deckKey(id);
    set((s) => {
      const bank = [...s[dk].loopBank];
      bank.splice(index, 1);
      return { [dk]: { ...s[dk], loopBank: bank } };
    });
    // Also remove any sequencer references to this index
    const trackKey = id === "A" ? "sequencerTracksA" : "sequencerTracksB";
    set((s) => ({
      [trackKey]: (s[trackKey] as number[]).filter((i) => i !== index).map((i) => i > index ? i - 1 : i),
    }));
  },

  setSequencerOpen: (open) => set({ sequencerOpen: open }),

  addSequencerSlot: (id, bankIndex) => {
    const trackKey = id === "A" ? "sequencerTracksA" : "sequencerTracksB";
    set((s) => ({
      [trackKey]: [...(s[trackKey] as number[]), bankIndex],
    }));
  },

  removeSequencerSlot: (id, slotIndex) => {
    const trackKey = id === "A" ? "sequencerTracksA" : "sequencerTracksB";
    set((s) => {
      const track = [...(s[trackKey] as number[])];
      track.splice(slotIndex, 1);
      return { [trackKey]: track };
    });
  },

  moveSequencerSlot: (id, fromIndex, toIndex) => {
    const trackKey = id === "A" ? "sequencerTracksA" : "sequencerTracksB";
    set((s) => {
      const track = [...(s[trackKey] as number[])];
      if (fromIndex < 0 || fromIndex >= track.length || toIndex < 0 || toIndex >= track.length) return {};
      const [item] = track.splice(fromIndex, 1);
      track.splice(toIndex, 0, item);
      return { [trackKey]: track };
    });
  },

  clearSequencerTrack: (id) => {
    const trackKey = id === "A" ? "sequencerTracksA" : "sequencerTracksB";
    set({ [trackKey]: [] });
  },

  playSequencer: async () => {
    get().stopSequencer();

    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();

    const { deckA, deckB, sequencerTracksA, sequencerTracksB } = get();
    const cfGains = getCrossfaderGains(get().crossfader);

    // Schedule all loops for a track
    const scheduleDeck = (
      deck: DeckState,
      trackSlots: number[],
      cfGain: number
    ): AudioBufferSourceNode[] => {
      if (!deck.sourceBuffer || trackSlots.length === 0) return [];
      const buf = (deck.activeStem && deck.stemBuffers?.[deck.activeStem]) || deck.sourceBuffer;
      const expanded = expandParams(deck.params);
      const sources: AudioBufferSourceNode[] = [];
      let offset = 0;

      for (const bankIdx of trackSlots) {
        const loop = deck.loopBank[bankIdx];
        if (!loop) continue;

        const loopDur = loop.end - loop.start;
        const playDur = loopDur / expanded.rate; // real-time duration at this rate

        const nodes = buildDeckGraph(
          ctx, buf, deck.params,
          loop.start, loopDur,
          deck.volume, cfGain,
          () => {}
        );
        // Override the start time — schedule at precise offset from now
        // buildDeckGraph already called source.start, so we stop and reschedule
        try { nodes.source.stop(); } catch { /* ok */ }

        // Create a fresh source for precise scheduling
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = expanded.rate;
        src.connect(nodes.lowShelf);
        src.start(ctx.currentTime + offset, loop.start, loopDur);
        sources.push(src);

        offset += playDur;
      }
      return sources;
    };

    seqSourcesA = scheduleDeck(deckA, sequencerTracksA, cfGains.a);
    seqSourcesB = scheduleDeck(deckB, sequencerTracksB, cfGains.b);

    set({ sequencerPlaying: true });

    // Auto-stop when all sources finish
    const allSources = [...seqSourcesA, ...seqSourcesB];
    if (allSources.length > 0) {
      const last = allSources[allSources.length - 1];
      last.onended = () => {
        set({ sequencerPlaying: false });
      };
    }
  },

  stopSequencer: () => {
    for (const s of seqSourcesA) { try { s.stop(); } catch { /* ok */ } }
    for (const s of seqSourcesB) { try { s.stop(); } catch { /* ok */ } }
    seqSourcesA = [];
    seqSourcesB = [];
    set({ sequencerPlaying: false });
  },

  lockBPM: () => {
    const { deckA, deckB, bpmLocked } = get();

    // Toggle off
    if (bpmLocked) {
      set({ bpmLocked: false });
      return;
    }

    if (!deckA.sourceBuffer || !deckB.sourceBuffer) return;

    // Use raw loop lengths for perfect precision (avoid BPM rounding)
    const loopA = (deckA.regionEnd > 0 ? deckA.regionEnd : deckA.sourceBuffer.duration) - deckA.regionStart;
    const loopB = (deckB.regionEnd > 0 ? deckB.regionEnd : deckB.sourceBuffer.duration) - deckB.regionStart;
    if (loopA <= 0 || loopB <= 0) return;

    // Target: make real-time loop durations equal
    // loopA / rateA = loopB / rateB  →  rateB = (loopB / loopA) * rateA
    const rateA = 1.0 + deckA.params.speed;
    const newRateB = (loopB / loopA) * rateA;
    const newSpeed = Math.max(-0.5, Math.min(0.5, newRateB - 1.0));
    get().setParam("B", "speed", newSpeed);
    if (deckB.params.pitchSpeedLinked ?? true) {
      get().setParam("B", "pitch", 12 * Math.log2(1.0 + newSpeed));
    }

    set({ bpmLocked: true });
  },

  applyStylePreset: (style) => {
    const preset = BATCH_PRESETS[style];
    for (const [k, v] of Object.entries(preset)) {
      if (v !== undefined) {
        get().setParam("A", k as keyof SimpleParams, v as number | boolean);
        get().setParam("B", k as keyof SimpleParams, v as number | boolean);
      }
    }
  },

  renderToBlob: async () => {
    console.log("[renderToBlob] starting offline render");
    try {
      const blob = await renderMixToWAV(get);
      if (!blob) {
        console.warn("[renderToBlob] no audio loaded — returning null");
        return null;
      }
      console.log(`[renderToBlob] complete — ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
      return blob;
    } catch (e) {
      console.error("[renderToBlob] offline render failed:", e);
      return null;
    }
  },

  download: async () => {
    const blob = await renderMixToWAV(get);
    if (!blob) return;

    const { deckA, deckB } = get();
    const hasA = !!deckA.sourceBuffer;
    const hasB = !!deckB.sourceBuffer;
    const nameA = deckA.sourceFilename || "deck-a";
    const nameB = deckB.sourceFilename || "deck-b";
    const filename = hasA && hasB
      ? `${nameA}-x-${nameB}-remix.wav`
      : `${hasA ? nameA : nameB}-remix.wav`;

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  },

  exportMP4: async () => {
    set({ isExporting: true });
    try {
      const blob = await renderMixToWAV(get, true);
      if (!blob) return;
      set({ pendingVideoExport: blob });
    } finally {
      set({ isExporting: false });
    }
  },

  armRecord: () => {
    const { recordArmed, isRecording } = get();
    if (isRecording) {
      get().stopRecording();
      return;
    }
    set({ recordArmed: !recordArmed });
  },

  stopRecording: () => {
    if (!liveRecorder || liveRecorder.state === "inactive") {
      set({ isRecording: false });
      return;
    }

    // Stop both decks
    get().stop("A");
    get().stop("B");

    liveRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: recordedChunks[0]?.type || "audio/webm" });
      recordedChunks = [];
      liveRecorder = null;
      set({ isRecording: false, pendingRecording: blob });
    };

    liveRecorder.stop();
  },

  toggleAutomation: (id) => {
    const deck = getDeck(get(), id);
    set({ [deckKey(id)]: { ...deck, automationEnabled: !deck.automationEnabled } });
  },

  addAutomationPoint: (id, time, value) => {
    const deck = getDeck(get(), id);
    const points = [...deck.automationPoints, { time, value }].sort((a, b) => a.time - b.time);
    set({ [deckKey(id)]: { ...deck, automationPoints: points } });
  },

  removeAutomationPoint: (id, index) => {
    const deck = getDeck(get(), id);
    const points = deck.automationPoints.filter((_, i) => i !== index);
    set({ [deckKey(id)]: { ...deck, automationPoints: points } });
  },

  moveAutomationPoint: (id, index, time, value) => {
    const deck = getDeck(get(), id);
    const points = [...deck.automationPoints];
    points[index] = { time, value };
    points.sort((a, b) => a.time - b.time);
    set({ [deckKey(id)]: { ...deck, automationPoints: points } });
  },

  toggleGridlock: (id) => {
    const dk = deckKey(id);
    const deck = getDeck(get(), id);
    if (deck.gridlockEnabled) {
      set((s) => ({ [dk]: { ...s[dk], gridlockEnabled: false, gridOffsetMs: 0, gridFirstTransient: 0, gridLockedSectionDur: 0 } }));
    } else {
      const firstTransient = deck.firstDownbeatMs !== null ? deck.firstDownbeatMs / 1000 : 0;
      // Lock section duration: 4 bars at current BPM, or 0 if no BPM yet
      const currentRate = 1.0 + deck.params.speed;
      const lockedDur = deck.calculatedBPM ? 960 / (deck.calculatedBPM * currentRate) : 0;
      set((s) => ({ [dk]: { ...s[dk], gridlockEnabled: true, gridOffsetMs: 0, gridFirstTransient: firstTransient, gridLockedSectionDur: lockedDur } }));
    }
  },

  setGridOffset: (id, ms) => {
    const dk = deckKey(id);
    set((s) => ({ [dk]: { ...s[dk], gridOffsetMs: ms } }));
  },

  lockGridSectionDur: (id) => {
    const dk = deckKey(id);
    const deck = getDeck(get(), id);
    if (!deck.gridlockEnabled || deck.gridLockedSectionDur > 0 || !deck.calculatedBPM) return;
    const currentRate = 1.0 + deck.params.speed;
    const lockedDur = 960 / (deck.calculatedBPM * currentRate);
    set((s) => ({ [dk]: { ...s[dk], gridLockedSectionDur: lockedDur } }));
  },
}));
