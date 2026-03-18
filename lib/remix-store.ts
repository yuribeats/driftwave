import { create } from "zustand";
import {
  SimpleParams,
  SIMPLE_DEFAULTS,
  expandParams,
} from "@yuribeats/audio-utils";
import { decodeFile } from "./file-decoder";
import { getAudioContext } from "./audio-context";

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

interface DeckState {
  sourceBuffer: AudioBuffer | null;
  sourceFilename: string | null;
  params: SimpleParams;
  isLoading: boolean;
  isPlaying: boolean;
  nodes: DeckNodes | null;
  startedAt: number;
  pauseOffset: number;
  volume: number;
}

type DeckId = "A" | "B";

const defaultDeck = (): DeckState => ({
  sourceBuffer: null,
  sourceFilename: null,
  params: { ...SIMPLE_DEFAULTS },
  isLoading: false,
  isPlaying: false,
  nodes: null,
  startedAt: 0,
  pauseOffset: 0,
  volume: 0.8,
});

interface RemixStore {
  deckA: DeckState;
  deckB: DeckState;
  crossfader: number;

  loadFile: (deck: DeckId, file: File) => Promise<void>;
  play: (deck: DeckId) => Promise<void>;
  stop: (deck: DeckId) => void;
  setParam: (deck: DeckId, key: keyof SimpleParams, value: number) => void;
  setVolume: (deck: DeckId, volume: number) => void;
  setCrossfader: (value: number) => void;
  eject: (deck: DeckId) => void;
}

/* ─── Shared output bus ─── */
let sharedMerger: GainNode | null = null;

function getSharedMerger(): GainNode {
  const ctx = getAudioContext();
  if (!sharedMerger || sharedMerger.context !== ctx) {
    sharedMerger = ctx.createGain();
    sharedMerger.connect(ctx.destination);
  }
  return sharedMerger;
}

/* ─── Build audio graph for a single deck ─── */
function buildDeckGraph(
  ctx: AudioContext,
  sourceBuffer: AudioBuffer,
  params: SimpleParams,
  offset: number,
  volume: number,
  crossfaderGain: number,
  onEnded: () => void
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

  // Connect: source → EQ → sat → reverb → analyser → deckGain → shared output
  source.connect(lowShelf);
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
  source.start(0, offset);

  return {
    source, lowShelf, peaking, highShelf, bump,
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

/* ─── Store ─── */
export const useRemixStore = create<RemixStore>((set, get) => ({
  deckA: defaultDeck(),
  deckB: defaultDeck(),
  crossfader: 0,

  loadFile: async (id, file) => {
    const key = deckKey(id);
    get().stop(id);
    set((s) => ({ [key]: { ...s[key], isLoading: true, pauseOffset: 0 } }));
    try {
      const audioBuffer = await decodeFile(file);
      set((s) => ({
        [key]: {
          ...s[key],
          sourceBuffer: audioBuffer,
          sourceFilename: file.name.replace(/\.[^/.]+$/, ""),
          isLoading: false,
        },
      }));
    } catch {
      set((s) => ({ [key]: { ...s[key], isLoading: false } }));
    }
  },

  play: async (id) => {
    const key = deckKey(id);
    const deck = getDeck(get(), id);
    if (!deck.sourceBuffer) return;
    if (deck.isPlaying) get().stop(id);

    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();

    const cfGains = getCrossfaderGains(get().crossfader);
    const cfGain = id === "A" ? cfGains.a : cfGains.b;

    const nodes = buildDeckGraph(
      ctx,
      deck.sourceBuffer,
      deck.params,
      deck.pauseOffset,
      deck.volume,
      cfGain,
      () => {
        set((s) => ({
          [key]: { ...s[key], isPlaying: false, nodes: null, pauseOffset: 0 },
        }));
      }
    );

    set((s) => ({
      [key]: {
        ...s[key],
        isPlaying: true,
        nodes,
        startedAt: ctx.currentTime - deck.pauseOffset,
      },
    }));
  },

  stop: (id) => {
    const key = deckKey(id);
    const deck = getDeck(get(), id);
    if (deck.nodes) {
      const ctx = getAudioContext();
      const elapsed = (ctx.currentTime - deck.startedAt) * expandParams(deck.params).rate;
      set((s) => ({
        [key]: { ...s[key], pauseOffset: elapsed, isPlaying: false, nodes: null },
      }));
      try { deck.nodes.source.stop(); } catch { /* already stopped */ }
    } else {
      set((s) => ({ [key]: { ...s[key], isPlaying: false, nodes: null } }));
    }
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
}));
