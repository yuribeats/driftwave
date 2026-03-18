import { create } from "zustand";
import {
  ProcessingParams,
  DEFAULTS,
  encodeWAV,
  renderOffline,
} from "@yuribeats/audio-utils";
import { decodeFile, decodeArrayBuffer } from "./file-decoder";
import { fetchYouTubeAudio } from "./cobalt";
import { getAudioContext } from "./audio-context";

interface AppStore {
  sourceFile: File | null;
  sourceBuffer: AudioBuffer | null;
  processedBuffer: AudioBuffer | null;
  sourceFilename: string | null;
  youtubeUrl: string | null;

  params: ProcessingParams;
  isProcessing: boolean;
  isLoading: boolean;
  progress: number;

  isPlaying: boolean;
  currentTime: number;
  playbackNode: AudioBufferSourceNode | null;
  startedAt: number;

  error: string | null;

  loadFile: (file: File) => Promise<void>;
  loadFromYouTube: (url: string) => Promise<void>;
  setParam: <K extends keyof ProcessingParams>(
    key: K,
    value: ProcessingParams[K]
  ) => void;
  process: () => Promise<void>;
  play: () => void;
  pause: () => void;
  download: () => void;
  clearError: () => void;
}

export const useStore = create<AppStore>((set, get) => ({
  sourceFile: null,
  sourceBuffer: null,
  processedBuffer: null,
  sourceFilename: null,
  youtubeUrl: null,

  params: { ...DEFAULTS },
  isProcessing: false,
  isLoading: false,
  progress: 0,

  isPlaying: false,
  currentTime: 0,
  playbackNode: null,
  startedAt: 0,

  error: null,

  loadFile: async (file: File) => {
    set({
      isLoading: true,
      error: null,
      processedBuffer: null,
      youtubeUrl: null,
    });
    try {
      const audioBuffer = await decodeFile(file);
      set({
        sourceFile: file,
        sourceBuffer: audioBuffer,
        sourceFilename: file.name.replace(/\.[^/.]+$/, ""),
        isLoading: false,
      });
    } catch {
      set({
        isLoading: false,
        error: "Failed to decode audio file",
      });
    }
  },

  loadFromYouTube: async (url: string) => {
    set({
      isLoading: true,
      error: null,
      processedBuffer: null,
      youtubeUrl: url,
    });
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
        error:
          err instanceof Error ? err.message : "Failed to fetch YouTube audio",
      });
    }
  },

  setParam: (key, value) => {
    set((state) => ({
      params: { ...state.params, [key]: value },
    }));
  },

  process: async () => {
    const { sourceBuffer, params } = get();
    if (!sourceBuffer) return;

    // Stop playback
    const { playbackNode } = get();
    if (playbackNode) {
      playbackNode.stop();
      set({ playbackNode: null, isPlaying: false });
    }

    set({ isProcessing: true, progress: 0, error: null });

    try {
      const channelData: Float32Array[] = [];
      for (let c = 0; c < sourceBuffer.numberOfChannels; c++) {
        channelData.push(new Float32Array(sourceBuffer.getChannelData(c)));
      }

      set({ progress: 0.1 });

      const result = await renderOffline({
        channelData,
        sampleRate: sourceBuffer.sampleRate,
        numberOfChannels: sourceBuffer.numberOfChannels,
        length: sourceBuffer.length,
        params,
      });

      set({ progress: 0.9 });

      const ctx = getAudioContext();
      const buf = ctx.createBuffer(
        result.numberOfChannels,
        result.length,
        result.sampleRate
      );
      for (let c = 0; c < result.numberOfChannels; c++) {
        buf.getChannelData(c).set(result.channelData[c]);
      }

      set({ processedBuffer: buf, isProcessing: false, progress: 1 });
    } catch (err) {
      set({
        isProcessing: false,
        error:
          err instanceof Error ? err.message : "Processing failed",
      });
    }
  },

  play: () => {
    const { processedBuffer, isPlaying, playbackNode } = get();
    if (!processedBuffer) return;

    if (isPlaying && playbackNode) {
      playbackNode.stop();
    }

    const ctx = getAudioContext();
    const source = ctx.createBufferSource();
    source.buffer = processedBuffer;
    source.connect(ctx.destination);
    source.onended = () => {
      set({ isPlaying: false, playbackNode: null, currentTime: 0 });
    };
    source.start(0);

    set({
      isPlaying: true,
      playbackNode: source,
      startedAt: ctx.currentTime,
    });
  },

  pause: () => {
    const { playbackNode } = get();
    if (playbackNode) {
      playbackNode.stop();
      set({ isPlaying: false, playbackNode: null });
    }
  },

  download: () => {
    const { processedBuffer, sourceFilename } = get();
    if (!processedBuffer) return;

    const blob = encodeWAV(processedBuffer);
    const filename = sourceFilename
      ? `${sourceFilename}-driftwave.wav`
      : "driftwave-output.wav";

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  clearError: () => set({ error: null }),
}));
