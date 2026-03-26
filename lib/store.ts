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
import { getAudioContext, isPitchWorkletReady } from "./audio-context";

interface AudioNodes {
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
}

interface PlaylistItem {
  id: string;
  name: string;
  url: string;
  settings: SimpleParams;
  createdAt: number;
}

interface AppStore {
  sourceBuffer: AudioBuffer | null;
  sourceFilename: string | null;
  sourceFile: File | null;
  youtubeUrl: string | null;

  params: SimpleParams;
  isLoading: boolean;
  isPlaying: boolean;
  isExporting: boolean;
  isSharing: boolean;
  error: string | null;

  nodes: AudioNodes | null;
  startedAt: number;
  pauseOffset: number;
  regionStart: number;
  regionEnd: number;

  playlist: PlaylistItem[];

  loadFile: (file: File) => Promise<void>;
  loadFromYouTube: (url: string) => Promise<void>;
  setParam: <K extends keyof SimpleParams>(key: K, value: SimpleParams[K]) => void;
  setParams: (params: SimpleParams) => void;
  play: () => Promise<void>;
  stop: () => void;
  rewind: () => void;
  fastForward: () => void;
  download: () => Promise<void>;
  randomize: () => void;
  share: () => Promise<string | null>;
  loadShare: (id: string) => Promise<void>;
  loadPlaylistItem: (item: PlaylistItem) => Promise<void>;
  seek: (time: number) => void;
  scrub: (time: number) => void;
  setRegion: (start: number, end: number) => void;
  fetchPlaylist: () => Promise<void>;
  eject: () => void;
  clearError: () => void;
}

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

function loadPlaylist(): PlaylistItem[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem("driftwave-playlist");
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function savePlaylist(items: PlaylistItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem("driftwave-playlist", JSON.stringify(items));
}

function buildGraph(
  ctx: AudioContext,
  sourceBuffer: AudioBuffer,
  params: SimpleParams,
  offset: number,
  onEnded: () => void
): AudioNodes {
  const expanded = expandParams(params);

  const source = ctx.createBufferSource();
  source.buffer = sourceBuffer;
  source.playbackRate.value = expanded.rate;

  // Pitch shifter (worklet) — inserted before EQ when unlinked
  let pitchShifter: AudioWorkletNode | null = null;
  if (!expanded.pitchSpeedLinked && isPitchWorkletReady()) {
    pitchShifter = new AudioWorkletNode(ctx, "soundtouch-processor");
    const pf = expanded.pitchFactor / expanded.rate;
    pitchShifter.port.postMessage({ pitchFactor: pf });
  }

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
  satMerger.gain.value = 1;

  // Reverb
  const convolver = ctx.createConvolver();
  convolver.buffer = generateIR(ctx, expanded.reverbDuration, expanded.reverbDecay);

  const dryGain = ctx.createGain();
  dryGain.gain.value = 1 - expanded.reverbWet;

  const wetGain = ctx.createGain();
  wetGain.gain.value = expanded.reverbWet;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;

  const merger = ctx.createGain();
  merger.gain.value = 1;

  // Signal chain: source → [pitchShifter] → EQ → saturation → reverb → output
  if (pitchShifter) {
    source.connect(pitchShifter);
    pitchShifter.connect(lowShelf);
  } else {
    source.connect(lowShelf);
  }
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
  dryGain.connect(merger);
  wetGain.connect(merger);
  merger.connect(analyser);
  analyser.connect(ctx.destination);

  source.onended = onEnded;
  source.start(0, offset);

  return { source, pitchShifter, lowShelf, peaking, highShelf, bump, waveshaper, satFilter, satDry, satWet, convolver, dryGain, wetGain, analyser };
}

export const useStore = create<AppStore>((set, get) => ({
  sourceBuffer: null,
  sourceFilename: null,
  sourceFile: null,
  youtubeUrl: null,

  params: { ...SIMPLE_DEFAULTS },
  isLoading: false,
  isPlaying: false,
  isExporting: false,
  isSharing: false,
  error: null,

  nodes: null,
  startedAt: 0,
  pauseOffset: 0,
  regionStart: 0,
  regionEnd: 0,

  playlist: loadPlaylist(),

  loadFile: async (file: File) => {
    get().stop();
    set({ isLoading: true, error: null, youtubeUrl: null, pauseOffset: 0 });
    try {
      const audioBuffer = await decodeFile(file);
      set({
        sourceBuffer: audioBuffer,
        sourceFile: file,
        sourceFilename: file.name.replace(/\.[^/.]+$/, ""),
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to decode audio file",
      });
    }
  },

  loadFromYouTube: async (url: string) => {
    get().stop();
    set({ isLoading: true, error: null, youtubeUrl: url, pauseOffset: 0 });
    try {
      const { buffer, title } = await fetchYouTubeAudio(url);
      const audioBuffer = await decodeArrayBuffer(buffer);
      set({
        sourceBuffer: audioBuffer,
        sourceFilename: title,
        sourceFile: null,
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

    if (key === "speed") {
      nodes.source.playbackRate.value = expanded.rate;
    }

    const toneKeys: (keyof SimpleParams)[] = ["tone", "eqLowOverride", "eqMidOverride", "eqHighOverride", "eqBumpFreqOverride", "eqBumpGainOverride"];
    if (toneKeys.includes(key)) {
      nodes.lowShelf.gain.value = expanded.eqLow;
      nodes.peaking.gain.value = expanded.eqMid;
      nodes.highShelf.gain.value = expanded.eqHigh;
      nodes.bump.frequency.value = expanded.eqBumpFreq;
      nodes.bump.gain.value = expanded.eqBumpGain;
    }

    const reverbKeys: (keyof SimpleParams)[] = ["reverb", "reverbWetOverride", "reverbDurationOverride", "reverbDecayOverride"];
    if (reverbKeys.includes(key)) {
      nodes.dryGain.gain.value = 1 - expanded.reverbWet;
      nodes.wetGain.gain.value = expanded.reverbWet;
      const ctx = getAudioContext();
      nodes.convolver.buffer = generateIR(ctx, expanded.reverbDuration, expanded.reverbDecay);
    }

    const satKeys: (keyof SimpleParams)[] = ["saturation", "satDriveOverride", "satMixOverride", "satToneOverride"];
    if (satKeys.includes(key)) {
      nodes.waveshaper.curve = makeSaturationCurve(expanded.satDrive);
      nodes.satFilter.frequency.value = expanded.satTone;
      nodes.satDry.gain.value = 1 - expanded.satMix;
      nodes.satWet.gain.value = expanded.satMix;
    }
  },

  setParams: (params: SimpleParams) => {
    set({ params });
    const { nodes } = get();
    if (!nodes) return;
    const expanded = expandParams(params);
    nodes.source.playbackRate.value = expanded.rate;
    nodes.lowShelf.gain.value = expanded.eqLow;
    nodes.highShelf.gain.value = expanded.eqHigh;
    nodes.bump.frequency.value = expanded.eqBumpFreq;
    nodes.bump.gain.value = expanded.eqBumpGain;
    nodes.dryGain.gain.value = 1 - expanded.reverbWet;
    nodes.wetGain.gain.value = expanded.reverbWet;
    const ctx = getAudioContext();
    nodes.convolver.buffer = generateIR(ctx, expanded.reverbDuration, expanded.reverbDecay);
  },

  play: async () => {
    const { sourceBuffer, params, isPlaying, pauseOffset } = get();
    if (!sourceBuffer) return;
    if (isPlaying) get().stop();

    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    const nodes = buildGraph(ctx, sourceBuffer, params, pauseOffset, () => {
      set({ isPlaying: false, nodes: null, pauseOffset: 0 });
    });

    set({
      isPlaying: true,
      nodes,
      startedAt: ctx.currentTime - pauseOffset,
    });
  },

  stop: () => {
    const { nodes, startedAt, params } = get();
    if (nodes) {
      const ctx = getAudioContext();
      const elapsed = (ctx.currentTime - startedAt) * expandParams(params).rate;
      set({ pauseOffset: elapsed });
      try { nodes.source.stop(); } catch { /* already stopped */ }
    }
    set({ isPlaying: false, nodes: null });
  },

  rewind: () => {
    const { isPlaying } = get();
    set({ pauseOffset: 0 });
    if (isPlaying) {
      get().stop();
      set({ pauseOffset: 0 });
      get().play();
    }
  },

  fastForward: () => {
    const { sourceBuffer, isPlaying, startedAt, params } = get();
    if (!sourceBuffer) return;
    const ctx = getAudioContext();
    const rate = expandParams(params).rate;
    const elapsed = isPlaying ? (ctx.currentTime - startedAt) * rate : get().pauseOffset;
    const newOffset = Math.min(elapsed + 10, sourceBuffer.duration - 0.1);
    set({ pauseOffset: newOffset });
    if (isPlaying) {
      get().stop();
      set({ pauseOffset: newOffset });
      get().play();
    }
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

      // Upload to Pinata in background
      const formData = new FormData();
      formData.append("audio", blob, filename);
      formData.append("filename", filename.replace(".wav", ""));
      formData.append("settings", JSON.stringify(params));

      fetch("/api/save", { method: "POST", body: formData })
        .then((res) => res.json())
        .then(({ id: saveId, audioUrl }) => {
          if (saveId && audioUrl) {
            const item: PlaylistItem = {
              id: saveId,
              name: filename.replace(".wav", ""),
              url: audioUrl,
              settings: { ...params },
              createdAt: Date.now(),
            };
            const updated = [item, ...get().playlist].slice(0, 50);
            set({ playlist: updated });
            savePlaylist(updated);
          }
        })
        .catch(() => {});
    } catch (err) {
      set({
        isExporting: false,
        error: err instanceof Error ? err.message : "Export failed",
      });
    }
  },

  randomize: () => {
    const newParams: SimpleParams = {
      speed: -0.5 + Math.random() * 1.0,
      pitch: 0,
      pitchSpeedLinked: true,
      reverb: Math.random(),
      tone: -1 + Math.random() * 2,
      saturation: Math.random() * 0.6,
    };
    get().setParams(newParams);
  },

  share: async () => {
    const { sourceFile, sourceBuffer, youtubeUrl, params, sourceFilename, playlist } = get();
    if (!sourceBuffer) return null;

    set({ isSharing: true, error: null });

    try {
      const formData = new FormData();
      formData.append("settings", JSON.stringify(params));
      formData.append("filename", sourceFilename || "audio");

      if (sourceFile) {
        formData.append("audio", sourceFile);
      } else if (youtubeUrl) {
        const res = await fetch("/api/cobalt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: youtubeUrl }),
        });
        if (!res.ok) throw new Error("Failed to fetch audio for sharing");
        const audioBlob = await res.blob();
        formData.append("audio", audioBlob, "audio.mp3");
      } else {
        throw new Error("No audio source to share");
      }

      const res = await fetch("/api/share", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Share failed");
      }

      const { id, audioUrl } = await res.json();
      const shareUrl = `${window.location.origin}/s/${id}`;

      await navigator.clipboard.writeText(shareUrl);

      // Add to playlist
      const item: PlaylistItem = {
        id,
        name: sourceFilename || "shared-track",
        url: audioUrl || "",
        settings: { ...params },
        createdAt: Date.now(),
      };
      const updated = [item, ...playlist].slice(0, 50);
      set({ isSharing: false, playlist: updated });
      savePlaylist(updated);

      return shareUrl;
    } catch (err) {
      set({
        isSharing: false,
        error: err instanceof Error ? err.message : "Share failed",
      });
      return null;
    }
  },

  loadShare: async (id: string) => {
    set({ isLoading: true, error: null, pauseOffset: 0 });

    try {
      const res = await fetch(`/api/share?id=${id}`);
      if (!res.ok) throw new Error("Share not found");

      const data = await res.json();
      const { settings, filename, audioUrl } = data;

      const audioRes = await fetch(audioUrl);
      const buffer = await audioRes.arrayBuffer();
      const audioBuffer = await decodeArrayBuffer(buffer);

      set({
        sourceBuffer: audioBuffer,
        sourceFilename: filename,
        params: settings,
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load shared track",
      });
    }
  },

  loadPlaylistItem: async (item: PlaylistItem) => {
    if (!item.url) return;
    get().stop();
    set({ isLoading: true, error: null, pauseOffset: 0 });

    try {
      const audioRes = await fetch(item.url);
      const buffer = await audioRes.arrayBuffer();
      const audioBuffer = await decodeArrayBuffer(buffer);

      set({
        sourceBuffer: audioBuffer,
        sourceFilename: item.name,
        params: { ...item.settings },
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load track",
      });
    }
  },

  fetchPlaylist: async () => {
    try {
      const res = await fetch("/api/save");
      if (!res.ok) return;
      const { items } = await res.json();
      if (items && items.length > 0) {
        set({ playlist: items });
        savePlaylist(items);
      }
    } catch {
      // silent fail, use local cache
    }
  },

  seek: (time: number) => {
    const { sourceBuffer, isPlaying } = get();
    if (!sourceBuffer) return;
    const clamped = Math.max(0, Math.min(time, sourceBuffer.duration - 0.1));
    set({ pauseOffset: clamped });
    if (isPlaying) {
      get().stop();
      set({ pauseOffset: clamped });
      get().play();
    }
  },

  scrub: (time: number) => {
    const { sourceBuffer } = get();
    if (!sourceBuffer) return;
    const clamped = Math.max(0, Math.min(time, sourceBuffer.duration));
    set({ pauseOffset: clamped });
  },

  setRegion: (start: number, end: number) => {
    set({ regionStart: start, regionEnd: end });
  },

  eject: () => {
    get().stop();
    set({
      sourceBuffer: null,
      sourceFile: null,
      sourceFilename: null,
      youtubeUrl: null,
      pauseOffset: 0,
      params: { ...SIMPLE_DEFAULTS },
    });
  },

  clearError: () => set({ error: null }),
}));
