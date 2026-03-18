"use client";

import { useState } from "react";
import Uploader from "../../components/Uploader";
import SpectrumAnalyzer from "../../components/SpectrumAnalyzer";
import Controls from "../../components/Controls";
import Player from "../../components/Player";
import DownloadButton from "../../components/DownloadButton";
import Toast from "../../components/Toast";
import { useStore } from "../../lib/store";

const btnClass =
  "bg-gradient-to-b from-[#4a4a4e] to-[#2a2a2e] border border-[#1a1a1a] text-dw-muted px-4 py-3 text-xs uppercase tracking-[0.15em] shadow-[0_2px_4px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.08)] hover:from-[#555] hover:to-[#333] hover:text-dw-text active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] font-mono disabled:opacity-50";

export default function Home() {
  const sourceBuffer = useStore((s) => s.sourceBuffer);
  const sourceFilename = useStore((s) => s.sourceFilename);
  const eject = useStore((s) => s.eject);
  const randomize = useStore((s) => s.randomize);
  const share = useStore((s) => s.share);
  const isSharing = useStore((s) => s.isSharing);
  const [shared, setShared] = useState(false);

  const handleShare = async () => {
    const url = await share();
    if (url) {
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    }
  };

  return (
    <main className="min-h-screen bg-[#0d0d0d] p-4 sm:p-8">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        <div className="bg-gradient-to-b from-[#3a3a3e] to-[#2a2a2e] border border-[#1a1a1a] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] px-6 py-3 flex items-center justify-between">
          <h1 className="text-sm text-dw-text uppercase tracking-[0.2em] font-bold">
            THE SLOWED AND REVERB MACHINE
          </h1>
          <div className="flex items-center gap-4">
            {sourceFilename && (
              <span className="text-[10px] text-dw-muted uppercase tracking-[0.1em]">
                {sourceFilename}
              </span>
            )}
            {sourceBuffer && (
              <button
                onClick={eject}
                className="text-[10px] text-dw-muted uppercase tracking-[0.15em] hover:text-dw-accent font-mono border border-[#333] px-3 py-1 hover:border-dw-accent"
                title="EJECT"
              >
                EJECT
              </button>
            )}
          </div>
        </div>

        <Uploader />
        <SpectrumAnalyzer />
        <Controls />

        {sourceBuffer && (
          <div className="bg-gradient-to-b from-[#3a3a3e] to-[#2a2a2e] border border-[#1a1a1a] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] px-4 py-3 flex items-center gap-3">
            <Player />
            <button onClick={randomize} className={btnClass}>
              RANDOM
            </button>
            <div className="flex-1" />
            <button
              onClick={handleShare}
              disabled={isSharing}
              className={btnClass}
            >
              {isSharing ? "SHARING..." : shared ? "LINK COPIED" : "SHARE"}
            </button>
            <DownloadButton />
          </div>
        )}

        <Toast />
      </div>
    </main>
  );
}
