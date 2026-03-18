"use client";

import { useEffect } from "react";
import { useStore } from "../../../../lib/store";
import SpectrumAnalyzer from "../../../../components/SpectrumAnalyzer";
import Controls from "../../../../components/Controls";
import Transport from "../../../../components/Transport";
import ProgressBar from "../../../../components/ProgressBar";
import DownloadButton from "../../../../components/DownloadButton";
import Toast from "../../../../components/Toast";

export default function SharePage({ params }: { params: { id: string } }) {
  const loadShare = useStore((s) => s.loadShare);
  const sourceBuffer = useStore((s) => s.sourceBuffer);
  const sourceFilename = useStore((s) => s.sourceFilename);
  const isLoading = useStore((s) => s.isLoading);

  useEffect(() => {
    loadShare(params.id);
  }, [params.id, loadShare]);

  return (
    <main className="min-h-screen flex items-center justify-center p-4 sm:p-8 relative vignette">
      <div className="flex max-w-[960px] w-full">
        <div className="wood-panel-left hidden sm:block" />

        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <div className="brushed-aluminum border border-[#666] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] px-6 py-3 flex items-center justify-between">
            <a href="/" className="text-sm text-[#333] uppercase tracking-[0.2em] font-bold">
              THE SLOWED AND REVERB MACHINE
            </a>
            {sourceFilename && (
              <span className="text-[10px] text-[#555] uppercase tracking-[0.1em]">
                {sourceFilename}
              </span>
            )}
          </div>

          {isLoading && (
            <div className="dark-faceplate border border-[#444] p-10 text-center">
              <p className="text-dw-gold uppercase tracking-[0.15em] text-xs">
                LOADING SHARED TRACK...
              </p>
            </div>
          )}

          <SpectrumAnalyzer />
          <Controls />

          {sourceBuffer && (
            <div className="brushed-aluminum border border-[#666] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] px-4 py-3 flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <Transport />
                <ProgressBar />
              </div>
              <div className="flex items-center justify-end">
                <DownloadButton />
              </div>
            </div>
          )}
        </div>

        <div className="wood-panel-right hidden sm:block" />
      </div>
      <Toast />
    </main>
  );
}
