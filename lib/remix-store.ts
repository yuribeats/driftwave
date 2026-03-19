import { create } from "zustand";
import {
  SimpleParams,
  SIMPLE_DEFAULTS,
  expandParams,
  renderOffline,
  encodeWAV,
} from "@yuribeats/audio-utils";
import { decodeFile } from "./file-decoder";
import { getAudioContext, ensurePitchWorklet, isPitchWorkletReady } from "./audio-context";

/* ─── Saturation curve ─── */
function makeSaturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const samples = 44100;
  const buffer = new ArrayBuffer(samples * 4);
  const curve = new Float32Array(buffer);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * drive);
  }
  return curve;
}

/* ─── Impulse response ─── */
function generateIR(ctx: AudioContext, duration: number, decay: number): AudioBuffer {
  const length = Math.ceil(ctx.sampleRate * duration);
  const ir = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = ir.getChannelData(c);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return ir;
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
  satDry: GainNode;
  satWet: GainNode;
  convolver: ConvolverNode;
  dryGain: GainNode;
  wetGain: GainNode;
  analyser: AnalyserNode;
  deckGain: GainNode;
}

type StemType = "vocals" | "drums" | "bass" | "other";

interface BankedLoop {
  name: string;
  start: number;
  end: number;
}

interface DeckState {
  sourceBuffer: AudioBuffer | null;
  sourceFilename: string | null;
  sourceFile: File | null;
  params: SimpleParams;
  isLoading: boolean;
  isPlaying: boolean;
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
}

type DeckId = "A" | "B";

const defaultDeck = (): DeckState => ({
  sourceBuffer: null,
  sourceFilename: null,
  sourceFile: null,
  params: { ...SIMPLE_DEFAULTS, speed: 0, reverb: 0, tone: 0, saturation: 0, pitch: 0, pitchSpeedLinked: true },
  isLoading: false,
  isPlaying: false,
  nodes: null,
  startedAt: 0,
  pauseOffset: 0,
  volume: 0.8,
  stemError: null,
  calculatedBPM: null,
  regionStart: 0,
  regionEnd: 0,
  activeStem: null,
  stemBuffers: null,
  isStemLoading: false,
  loopBank: [],
});

interface MasterBusParams {
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
    threshold: m.limiterThreshold ?? (-1 - amt * 12), // -1 to -13 dB
    ratio: 20,       // brick wall
    attack: 0.001,   // 1ms — fast attack
    release: m.limiterRelease ?? (0.01 + amt * 0.1),
    knee: m.limiterKnee ?? 0,
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

  // Sequencer
  sequencerOpen: boolean;
  sequencerTracksA: number[];  // indices into deckA.loopBank
  sequencerTracksB: number[];  // indices into deckB.loopBank
  sequencerPlaying: boolean;

  loadFile: (deck: DeckId, file: File) => Promise<void>;
  play: (deck: DeckId) => Promise<void>;
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
  playSequencer: () => Promise<void>;
  stopSequencer: () => void;
  lockBPM: () => void;
  download: () => Promise<void>;
}

/* ─── Shared output bus: merger → EQ → compressor → makeup → limiter → destination ─── */
let sharedMerger: GainNode | null = null;
let masterLow: BiquadFilterNode | null = null;
let masterMid: BiquadFilterNode | null = null;
let masterHigh: BiquadFilterNode | null = null;
let masterComp: DynamicsCompressorNode | null = null;
let masterMakeup: GainNode | null = null;
let masterLimiter: DynamicsCompressorNode | null = null;

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
  }
  return sharedMerger;
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
  loopRegion?: { loopStart: number; loopEnd: number }
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
  peaking.Q.value = 1.0;
  peaking.gain.value = expanded.eqMid;

  const highShelf = ctx.createBiquadFilter();
  highShelf.type = "highshelf";
  highShelf.frequency.value = 8000;
  highShelf.gain.value = expanded.eqHigh;

  const bump = ctx.createBiquadFilter();
  bump.type = "peaking";
  bump.frequency.value = expanded.eqBumpFreq;
  bump.Q.value = 1.5;
  bump.gain.value = expanded.eqBumpGain;

  // Saturation
  const waveshaper = ctx.createWaveShaper();
  waveshaper.curve = makeSaturationCurve(expanded.satDrive);
  waveshaper.oversample = "4x";

  const satFilter = ctx.createBiquadFilter();
  satFilter.type = "lowpass";
  satFilter.frequency.value = expanded.satTone;
  satFilter.Q.value = 0.707;

  const satDry = ctx.createGain();
  satDry.gain.value = 1 - expanded.satMix;

  const satWet = ctx.createGain();
  satWet.gain.value = expanded.satMix;

  const satMerger = ctx.createGain();

  // Reverb
  const convolver = ctx.createConvolver();
  convolver.buffer = generateIR(ctx, expanded.reverbDuration, expanded.reverbDecay);

  const dryGain = ctx.createGain();
  dryGain.gain.value = 1 - expanded.reverbWet;

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

  // Pitch shifter worklet (unlinked mode only)
  let pitchShifter: AudioWorkletNode | null = null;
  if (!expanded.pitchSpeedLinked && isPitchWorkletReady()) {
    pitchShifter = new AudioWorkletNode(ctx, "pitch-shifter-processor");
    const netShift = expanded.pitchFactor / expanded.rate;
    pitchShifter.port.postMessage({ pitchFactor: netShift });
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

  bump.connect(satDry);
  bump.connect(waveshaper);
  waveshaper.connect(satFilter);
  satFilter.connect(satWet);
  satDry.connect(satMerger);
  satWet.connect(satMerger);

  satMerger.connect(dryGain);
  satMerger.connect(convolver);
  convolver.connect(wetGain);
  dryGain.connect(reverbMerger);
  wetGain.connect(reverbMerger);

  reverbMerger.connect(analyser);
  analyser.connect(deckGain);
  deckGain.connect(getSharedMerger());

  source.onended = onEnded;
  if (loopRegion) {
    source.loop = true;
    source.loopStart = loopRegion.loopStart;
    source.loopEnd = loopRegion.loopEnd;
    source.start(0, offset);
  } else if (duration && duration > 0) {
    source.start(0, offset, duration);
  } else {
    source.start(0, offset);
  }

  return {
    source, pitchShifter, lowShelf, peaking, highShelf, bump,
    waveshaper, satFilter, satDry, satWet,
    convolver, dryGain, wetGain, analyser, deckGain,
  };
}

/* ─── Helper to get/set deck state ─── */
function getDeck(state: RemixStore, id: DeckId): DeckState {
  return id === "A" ? state.deckA : state.deckB;
}

function deckKey(id: DeckId): "deckA" | "deckB" {
  return id === "A" ? "deckA" : "deckB";
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
  sequencerOpen: false,
  sequencerTracksA: [],
  sequencerTracksB: [],
  sequencerPlaying: false,

  loadFile: async (id, file) => {
    const dk = deckKey(id);
    get().stop(id);
    set((s) => ({ [dk]: { ...s[dk], isLoading: true, pauseOffset: 0, calculatedBPM: null, activeStem: null, stemBuffers: null, stemError: null, sourceFile: file } }));
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

  play: async (id) => {
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
    const playOffset = freshDeck.pauseOffset >= rStart ? freshDeck.pauseOffset : rStart;
    const remaining = rEnd - playOffset;
    const playDuration = remaining > 0 ? remaining : undefined;

    const nodes = buildDeckGraph(
      ctx,
      playBuffer,
      freshDeck.params,
      playOffset,
      hasRegion ? undefined : playDuration,
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
      hasRegion ? { loopStart: rStart, loopEnd: rEnd } : undefined
    );

    set((s) => ({
      [key]: {
        ...s[key],
        isPlaying: true,
        nodes,
        startedAt: ctx.currentTime - (playOffset - rStart),
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
    set((s) => ({
      [key]: {
        ...s[key],
        params: { ...s[key].params, [paramKey]: value },
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
      deck.nodes.pitchShifter.port.postMessage({ pitchFactor: netShift });
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
      deck.nodes.dryGain.gain.value = 1 - expanded.reverbWet;
      deck.nodes.wetGain.gain.value = expanded.reverbWet;
      const ctx = getAudioContext();
      deck.nodes.convolver.buffer = generateIR(ctx, expanded.reverbDuration, expanded.reverbDecay);
    }

    const satKeys: (keyof SimpleParams)[] = ["saturation", "satDriveOverride", "satMixOverride", "satToneOverride"];
    if (satKeys.includes(paramKey)) {
      deck.nodes.waveshaper.curve = makeSaturationCurve(expanded.satDrive);
      deck.nodes.satFilter.frequency.value = expanded.satTone;
      deck.nodes.satDry.gain.value = 1 - expanded.satMix;
      deck.nodes.satWet.gain.value = expanded.satMix;
    }

    // BPM lock: Deck A speed/pitch changes propagate to Deck B
    if (id === "A" && get().bpmLocked && (paramKey === "speed" || paramKey === "pitch")) {
      const { deckA, deckB } = get();
      if (deckA.calculatedBPM && deckB.calculatedBPM) {
        const rateA = 1.0 + deckA.params.speed;
        const targetBPM = deckA.calculatedBPM * rateA;
        const newRateB = targetBPM / deckB.calculatedBPM;
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
            deckBFresh.nodes.pitchShifter.port.postMessage({ pitchFactor: expB.pitchFactor / expB.rate });
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
    const { deckA, deckB } = get();
    const hasA = !!deckA.sourceBuffer;
    const hasB = !!deckB.sourceBuffer;
    if (!hasA && !hasB) return;

    // Stop both first
    if (hasA) get().stop("A");
    if (hasB) get().stop("B");

    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();

    // Start both — play() is async but the actual source.start() inside
    // happens on the same AudioContext so they'll be sample-aligned
    if (hasA) get().play("A");
    if (hasB) get().play("B");
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
    if (!deck.sourceFile || deck.isStemLoading) return;

    const wasPlaying = deck.isPlaying;
    if (wasPlaying) get().pause(id);

    set((s) => ({ [dk]: { ...s[dk], isStemLoading: true, stemError: null } }));

    try {
      const formData = new FormData();
      formData.append("audio", deck.sourceFile);

      const res = await fetch("/api/stems", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        let msg = "Stem separation failed";
        try { const d = await res.json(); msg = d.error || msg; } catch { /* ok */ }
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
    if (!deckA.calculatedBPM || !deckB.calculatedBPM) return;

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

  download: async () => {
    const { deckA, deckB, crossfader, masterBus } = get();
    const hasA = !!deckA.sourceBuffer;
    const hasB = !!deckB.sourceBuffer;
    if (!hasA && !hasB) return;

    set({ isExporting: true });

    try {
      const cfGains = getCrossfaderGains(crossfader);
      const renders: { data: Float32Array[]; gain: number; sr: number; nch: number }[] = [];

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
        });
      }

      if (renders.length === 0) {
        set({ isExporting: false });
        return;
      }

      const sr = renders[0].sr;
      const nch = Math.max(...renders.map((r) => r.nch));
      const maxLen = Math.max(...renders.map((r) => r.data[0].length));

      // Mix all renders together
      const mixed: Float32Array[] = [];
      for (let c = 0; c < nch; c++) mixed.push(new Float32Array(maxLen));
      for (const r of renders) {
        for (let c = 0; c < nch; c++) {
          const ch = c < r.data.length ? r.data[c] : r.data[0];
          for (let i = 0; i < ch.length; i++) {
            mixed[c][i] += ch[i] * r.gain;
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

      const blob = encodeWAV(rendered);
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
    } finally {
      set({ isExporting: false });
    }
  },
}));
