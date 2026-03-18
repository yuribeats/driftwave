"use client";

import Uploader from "../../components/Uploader";
import SpectrumAnalyzer from "../../components/SpectrumAnalyzer";
import Controls from "../../components/Controls";
import Transport from "../../components/Transport";
import DownloadButton from "../../components/DownloadButton";
import ProgressBar from "../../components/ProgressBar";
import Toast from "../../components/Toast";
import { useStore } from "../../lib/store";

const btnClass =
  "bg-gradient-to-b from-[#c0c0c0] via-[#a0a0a0] to-[#888] border border-[#666] text-[#333] px-4 py-3 text-xs uppercase tracking-[0.15em] shadow-[0_2px_4px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.4)] hover:from-[#d0d0d0] hover:to-[#999] hover:text-[#111] active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] font-mono disabled:opacity-50";

export default function Home() {
  const sourceBuffer = useStore((s) => s.sourceBuffer);
  const randomize = useStore((s) => s.randomize);

  return (
    <main className="min-h-screen wood-grain p-4 sm:p-8">
      <div className="max-w-4xl mx-auto flex flex-col gap-1">
        {/* Header */}
        <div className="wood-grain p-[6px]">
          <div className="brushed-aluminum border border-[#666] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] px-6 py-3 flex items-center justify-between">
            <h1 className="text-sm text-[#333] uppercase tracking-[0.2em] font-bold">
              THE SLOWED AND REVERB MACHINE
            </h1>
            <Uploader />
          </div>
        </div>

        <SpectrumAnalyzer />
        <Controls />

        {/* Transport bar */}
        <div className="wood-grain p-[6px]">
          <div className="brushed-aluminum border border-[#666] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <Transport />
              <ProgressBar />
            </div>
            <div className="flex items-center gap-3">
              <button onClick={randomize} disabled={!sourceBuffer} className={btnClass}>
                RANDOM
              </button>
              <div className="flex-1" />
              <DownloadButton />
            </div>
          </div>
        </div>

        <Toast />
      </div>
    </main>
  );
}
