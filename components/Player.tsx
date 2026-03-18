"use client";

import { useStore } from "../lib/store";

export default function Player() {
  const processedBuffer = useStore((s) => s.processedBuffer);
  const isPlaying = useStore((s) => s.isPlaying);
  const play = useStore((s) => s.play);
  const pause = useStore((s) => s.pause);

  if (!processedBuffer) return null;

  return (
    <div className="flex gap-2">
      {isPlaying ? (
        <button
          onClick={pause}
          className="bg-dw-surface2 border border-dw-border text-dw-text px-4 py-3 text-sm uppercase tracking-widest hover:border-dw-accent"
        >
          STOP
        </button>
      ) : (
        <button
          onClick={play}
          className="bg-dw-surface2 border border-dw-border text-dw-text px-4 py-3 text-sm uppercase tracking-widest hover:border-dw-accent"
        >
          PLAY
        </button>
      )}
    </div>
  );
}
