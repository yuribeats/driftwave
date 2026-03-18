"use client";

import { useStore } from "../lib/store";

export default function DownloadButton() {
  const processedBuffer = useStore((s) => s.processedBuffer);
  const download = useStore((s) => s.download);

  if (!processedBuffer) return null;

  return (
    <button
      onClick={download}
      className="bg-dw-surface2 border border-dw-accent text-dw-accent px-4 py-3 text-sm uppercase tracking-widest hover:bg-dw-accent hover:text-dw-bg"
    >
      DOWNLOAD WAV
    </button>
  );
}
