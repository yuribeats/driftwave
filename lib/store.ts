import { create } from "zustand";
import {
  SimpleParams,
  SIMPLE_DEFAULTS,
  expandParams,
  encodeWAV,
  renderOffline,
} from "@yuribeats/audio-utils";
import { decodeFile, decodeArrayBuffer } from "./file-decoder";
import { fetchYouTubeAudio } from "./cobalt";
import { getAudioContext } from "./audio-context";

interface AudioNodes {
  source: AudioBufferSourceNode;
  lowShelf: BiquadFilterNode;
  peaking: BiquadFilterNode;
  highShelf: BiquadFilterNode;
  convolver: ConvolverNode;
  dryGain: GainNode;
  wetGain: GainNode;
  analyser: AnalyserNode;
}

interface AppStore {
  sourceBuffer: AudioBuffer | null;
  sourceFilename: string | null;
  youtubeUrl: string | null;

  params: SimpleParams;
  isLoading: boolean;
  isPlaying: boolean;
  isExporting: boolean;
  error: string | null;

  nodes: AudioNodes | null;
  startedAt: number;

  loadFile: (file: File) => Promise<void>;
  loadFromYouTube: (url: string) => Promise<void>;
  setParam: <K extends keyof SimpleParams>(key: K, value: SimpleParams[K]) => void;
  play: () => void;
  stop: () => void;
  download: () => Promise<void>;
  clearError: () => void;
}

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

function normalizeBuffer(buffer: AudioBuffer): AudioBuffer {
  const ctx = getAudioContext();
  const normalized = ctx.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }
  const gain = peak > 0 ? 1.0 / peak : 1;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = normalized.getChannelData(c);
    for (let i = 0; i < src.length; i++) {
      dst[i] = src[i] * gain;
    }
  }
  return normalized;
}

export const useStore = create<AppStore>((set, get) => ({
  sourceBuffer: null,
  sourceFilename: null,
  youtubeUrl: null,

  params: { ...SIMPLE_DEFAULTS },
  isLoading: false,
  isPlaying: false,
  isExporting: false,
  error: null,

  nodes: null,
  startedAt: 0,

  loadFile: async (file: File) => {
    get().stop();
    set({ isLoading: true, error: null, youtubeUrl: null });
    try {
      const audioBuffer = await decodeFile(file);
      set({
        sourceBuffer: audioBuffer,
        sourceFilename: file.name.replace(/\.[^/.]+$/, ""),
        isLoading: false,
      });
    } catch {
      set({ isLoading: false, error: "Failed to decode audio file" });
    }
  },

  loadFromYouTube: async (url: string) => {
    get().stop();
    set({ isLoading: true, error: null, youtubeUrl: url });
    try {
      const { buffer, title } = await fetchYouTubeAudio(url);
      const audioBuffer = await decodeArrayBuffer(buffer);
      set({
        sourceBuffer: audioBuffer,
        sourceFilename: title,
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to fetch YouTube audio",
      });
    }
  },

  setParam: (key, value) => {
    set((state) => ({
      params: { ...state.params, [key]: value },
    }));

    const { nodes } = get();
    if (!nodes) return;

    const newSimple = { ...get().params, [key]: value };
    const expanded = expandParams(newSimple);

    if (key === "rate") {
      nodes.source.playbackRate.value = expanded.rate;
    }

    if (key === "tone") {
      nodes.lowShelf.gain.value = expanded.eqLow;
      nodes.highShelf.gain.value = expanded.eqHigh;
    }

    if (key === "reverb") {
      nodes.dryGain.gain.value = 1 - expanded.reverbWet;
      nodes.wetGain.gain.value = expanded.reverbWet;
      const ctx = getAudioContext();
      nodes.convolver.buffer = generateIR(ctx, expanded.reverbDuration, expanded.reverbDecay);
    }
  },

  play: () => {
    const { sourceBuffer, params, isPlaying } = get();
    if (!sourceBuffer) return;
    if (isPlaying) get().stop();

    const ctx = getAudioContext();
    const expanded = expandParams(params);

    const source = ctx.createBufferSource();
    source.buffer = sourceBuffer;
    source.playbackRate.value = expanded.rate;

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

    const convolver = ctx.createConvolver();
    convolver.buffer = generateIR(ctx, expanded.reverbDuration, expanded.reverbDecay);

    const dryGain = ctx.createGain();
    dryGain.gain.value = 1 - expanded.reverbWet;

    const wetGain = ctx.createGain();
    wetGain.gain.value = expanded.reverbWet;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    // Merge node to combine dry + wet before analyser
    const merger = ctx.createGain();
    merger.gain.value = 1;

    source.connect(lowShelf);
    lowShelf.connect(peaking);
    peaking.connect(highShelf);
    highShelf.connect(dryGain);
    highShelf.connect(convolver);
    convolver.connect(wetGain);
    dryGain.connect(merger);
    wetGain.connect(merger);
    merger.connect(analyser);
    analyser.connect(ctx.destination);

    source.onended = () => {
      set({ isPlaying: false, nodes: null });
    };

    source.start(0);

    set({
      isPlaying: true,
      nodes: { source, lowShelf, peaking, highShelf, convolver, dryGain, wetGain, analyser },
      startedAt: ctx.currentTime,
    });
  },

  stop: () => {
    const { nodes } = get();
    if (nodes) {
      try { nodes.source.stop(); } catch { /* already stopped */ }
    }
    set({ isPlaying: false, nodes: null });
  },

  download: async () => {
    const { sourceBuffer, params, sourceFilename } = get();
    if (!sourceBuffer) return;

    set({ isExporting: true, error: null });

    try {
      const expanded = expandParams(params);
      const channelData: Float32Array[] = [];
      for (let c = 0; c < sourceBuffer.numberOfChannels; c++) {
        channelData.push(new Float32Array(sourceBuffer.getChannelData(c)));
      }

      const result = await renderOffline({
        channelData,
        sampleRate: sourceBuffer.sampleRate,
        numberOfChannels: sourceBuffer.numberOfChannels,
        length: sourceBuffer.length,
        params: expanded,
      });

      const ctx = getAudioContext();
      const buf = ctx.createBuffer(
        result.numberOfChannels,
        result.length,
        result.sampleRate
      );
      for (let c = 0; c < result.numberOfChannels; c++) {
        buf.getChannelData(c).set(result.channelData[c]);
      }

      const normalized = normalizeBuffer(buf);
      const blob = encodeWAV(normalized);
      const filename = sourceFilename
        ? `${sourceFilename}-driftwave.wav`
        : "driftwave-output.wav";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      set({ isExporting: false });
    } catch (err) {
      set({
        isExporting: false,
        error: err instanceof Error ? err.message : "Export failed",
      });
    }
  },

  clearError: () => set({ error: null }),
}));
