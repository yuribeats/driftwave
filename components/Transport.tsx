"use client";

import { useRef, useCallback } from "react";
import { useStore } from "../lib/store";

const btnBase =
  "bg-gradient-to-b from-[#c0c0c0] via-[#a0a0a0] to-[#888] border border-[#666] shadow-[0_2px_4px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.4)] hover:from-[#d0d0d0] hover:to-[#999] active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] disabled:opacity-50 flex items-center justify-center";

export default function Transport() {
  const sourceBuffer = useStore((s) => s.sourceBuffer);
  const isPlaying = useStore((s) => s.isPlaying);
  const play = useStore((s) => s.play);
  const stop = useStore((s) => s.stop);
  const rewind = useStore((s) => s.rewind);
  const fastForward = useStore((s) => s.fastForward);
  const eject = useStore((s) => s.eject);
  const loadFile = useStore((s) => s.loadFile);
  const inputRef = useRef<HTMLInputElement>(null);

  const off = !sourceBuffer;

  const handleEject = useCallback(() => {
    if (sourceBuffer) {
      eject();
    }
    inputRef.current?.click();
  }, [sourceBuffer, eject]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadFile(file);
      if (inputRef.current) inputRef.current.value = "";
    },
    [loadFile]
  );

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      <button
        onClick={rewind}
        disabled={off}
        className={`${btnBase} w-10 h-10 text-[#333] hover:text-[#111]`}
        title="REWIND"
      >
        <span className="text-sm leading-none">&#9198;</span>
      </button>

      {isPlaying ? (
        <button
          onClick={stop}
          className={`${btnBase} w-10 h-10 text-[#333]`}
          title="STOP"
        >
          <span className="text-xs leading-none">&#9632;</span>
        </button>
      ) : (
        <button
          onClick={play}
          disabled={off}
          className={`${btnBase} w-10 h-10 text-[#333]`}
          title="PLAY"
        >
          <span className="text-sm leading-none">&#9654;</span>
        </button>
      )}

      <button
        onClick={fastForward}
        disabled={off}
        className={`${btnBase} w-10 h-10 text-[#333] hover:text-[#111]`}
        title="FAST FORWARD"
      >
        <span className="text-sm leading-none">&#9197;</span>
      </button>

      <button
        onClick={handleEject}
        className={`${btnBase} w-10 h-10 text-[#333] hover:text-[#111] ml-2`}
        title="EJECT"
      >
        <span className="text-sm leading-none">&#9167;</span>
      </button>
    </div>
  );
}
