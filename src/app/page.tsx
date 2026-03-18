"use client";

import Uploader from "../../components/Uploader";
import WaveformCanvas from "../../components/WaveformCanvas";
import Controls from "../../components/Controls";
import ProcessButton from "../../components/ProcessButton";
import Player from "../../components/Player";
import DownloadButton from "../../components/DownloadButton";
import Toast from "../../components/Toast";
import { useStore } from "../../lib/store";

export default function Home() {
  const sourceBuffer = useStore((s) => s.sourceBuffer);
  const sourceFilename = useStore((s) => s.sourceFilename);

  return (
    <main className="min-h-screen bg-dw-bg p-4 sm:p-8">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between border border-dw-border p-4">
          <h1 className="text-lg text-dw-text uppercase tracking-[0.2em] font-bold">
            DRIFTWAVE
          </h1>
          {sourceFilename && (
            <span className="text-xs text-dw-muted uppercase tracking-wider">
              {sourceFilename}
            </span>
          )}
        </div>

        {/* Upload / Waveform */}
        <Uploader />
        <WaveformCanvas />

        {/* Controls */}
        <Controls />

        {/* Action bar */}
        {sourceBuffer && (
          <div className="flex flex-wrap items-center gap-3">
            <ProcessButton />
            <Player />
            <div className="flex-1" />
            <DownloadButton />
          </div>
        )}

        <Toast />
      </div>
    </main>
  );
}
