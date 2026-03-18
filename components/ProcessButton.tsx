"use client";

import { useStore } from "../lib/store";

export default function ProcessButton() {
  const sourceBuffer = useStore((s) => s.sourceBuffer);
  const isProcessing = useStore((s) => s.isProcessing);
  const progress = useStore((s) => s.progress);
  const process = useStore((s) => s.process);

  if (!sourceBuffer) return null;

  return (
    <button
      onClick={process}
      disabled={isProcessing}
      className="relative bg-dw-surface2 border border-dw-accent text-dw-accent px-6 py-3 text-sm uppercase tracking-widest hover:bg-dw-accent hover:text-dw-bg disabled:opacity-50 overflow-hidden"
    >
      {isProcessing && (
        <div
          className="absolute inset-0 bg-dw-accent/20 transition-all"
          style={{ width: `${progress * 100}%` }}
        />
      )}
      <span className="relative z-10">
        {isProcessing ? `PROCESSING ${Math.round(progress * 100)}%` : "PROCESS"}
      </span>
    </button>
  );
}
