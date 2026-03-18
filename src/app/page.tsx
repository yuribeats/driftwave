"use client";

import Uploader from "../../components/Uploader";
import SpectrumAnalyzer from "../../components/SpectrumAnalyzer";
import Controls from "../../components/Controls";
import Player from "../../components/Player";
import DownloadButton from "../../components/DownloadButton";
import Toast from "../../components/Toast";
import { useStore } from "../../lib/store";

export default function Home() {
  const sourceBuffer = useStore((s) => s.sourceBuffer);
  const sourceFilename = useStore((s) => s.sourceFilename);

  return (
    <main className="min-h-screen bg-[#0d0d0d] p-4 sm:p-8">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        {/* Header — rack panel style */}
        <div className="bg-gradient-to-b from-[#3a3a3e] to-[#2a2a2e] border border-[#1a1a1a] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] px-6 py-3 flex items-center justify-between">
          <h1 className="text-sm text-dw-text uppercase tracking-[0.2em] font-bold">
            THE SLOWED AND REVERB MACHINE
          </h1>
          {sourceFilename && (
            <span className="text-[10px] text-dw-muted uppercase tracking-[0.1em]">
              {sourceFilename}
            </span>
          )}
        </div>

        <Uploader />
        <SpectrumAnalyzer />
        <Controls />

        {/* Transport bar */}
        {sourceBuffer && (
          <div className="bg-gradient-to-b from-[#3a3a3e] to-[#2a2a2e] border border-[#1a1a1a] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] px-4 py-3 flex items-center gap-3">
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
