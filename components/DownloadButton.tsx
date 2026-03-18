"use client";

import { useStore } from "../lib/store";

export default function DownloadButton() {
  const sourceBuffer = useStore((s) => s.sourceBuffer);
  const isExporting = useStore((s) => s.isExporting);
  const download = useStore((s) => s.download);

  return (
    <button
      onClick={download}
      disabled={!sourceBuffer || isExporting}
      className="bg-gradient-to-b from-[#c0c0c0] via-[#a0a0a0] to-[#888] border border-dw-amber text-[#333] px-5 py-3 text-xs uppercase tracking-[0.15em] shadow-[0_2px_4px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.4)] hover:from-[#d0d0d0] hover:to-[#999] active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] disabled:opacity-50 font-mono"
    >
      {isExporting ? "EXPORTING..." : "DOWNLOAD WAV"}
    </button>
  );
}
