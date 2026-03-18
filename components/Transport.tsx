"use client";

import { useRef, useCallback } from "react";
import { useStore } from "../lib/store";

const btnBase = "rocker-switch";

export default function Transport() {
  const sourceBuffer = useStore((s) => s.sourceBuffer);
  const isPlaying = useStore((s) => s.isPlaying);
  const play = useStore((s) => s.play);
  const stop = useStore((s) => s.stop);
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
    <div className="flex items-center gap-4 flex-wrap justify-center">
      <input ref={inputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileSelect} />

      {/* Play/Stop */}
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-2 mb-2">
          <span className="label" style={{ margin: 0, fontSize: "10px" }}>{isPlaying ? "STOP" : "PLAY"}</span>
          <div className="led-cutout">
            <div className={`led-rect ${isPlaying ? "led-green-on" : "led-green"}`} />
          </div>
        </div>
        <button
          onClick={isPlaying ? stop : play}
          disabled={!isPlaying && off}
          className={btnBase}
        >
          <div className="w-2 h-2 rounded-full border-2 border-[#555]" />
        </button>
      </div>

      {/* Eject */}
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-2 mb-2">
          <span className="label" style={{ margin: 0, fontSize: "10px" }}>EJECT</span>
          <div className="led-cutout">
            <div className={`led-rect ${sourceBuffer ? "led-red-on" : "led-red"}`} />
          </div>
        </div>
        <button onClick={handleEject} className={btnBase}>
          <div className="w-2 h-2 rounded-full border-2 border-[#555]" />
        </button>
      </div>
    </div>
  );
}
