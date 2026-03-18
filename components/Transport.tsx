"use client";

import { useRef, useCallback } from "react";
import { useStore } from "../lib/store";
import { getAudioContext } from "../lib/audio-context";

const btnBase = "rocker-switch";

export default function Transport() {
  const sourceBuffer = useStore((s) => s.sourceBuffer);
  const isPlaying = useStore((s) => s.isPlaying);
  const isExporting = useStore((s) => s.isExporting);
  const isLoading = useStore((s) => s.isLoading);
  const play = useStore((s) => s.play);
  const stop = useStore((s) => s.stop);
  const eject = useStore((s) => s.eject);
  const loadFile = useStore((s) => s.loadFile);
  const randomize = useStore((s) => s.randomize);
  const download = useStore((s) => s.download);
  const inputRef = useRef<HTMLInputElement>(null);

  const off = !sourceBuffer;

  const handleLoad = useCallback(async () => {
    const ctx = getAudioContext();
    await ctx.resume();
    if (sourceBuffer) {
      eject();
    }
    inputRef.current?.click();
  }, [sourceBuffer, eject]);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const ctx = getAudioContext();
      await ctx.resume();
      const file = e.target.files?.[0];
      if (file) loadFile(file);
      if (inputRef.current) inputRef.current.value = "";
    },
    [loadFile]
  );

  return (
    <div className="flex items-center gap-4 flex-wrap justify-center">
      <input ref={inputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileSelect} />

      {/* Load */}
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-2 mb-2">
          <span className="label" style={{ margin: 0, fontSize: "10px" }}>LOAD</span>
          <div className="led-cutout">
            <div className={`led-rect ${isLoading ? "led-green-on" : sourceBuffer ? "led-green-on" : "led-green"}`} />
          </div>
        </div>
        <button
          onClick={handleLoad}
          disabled={isLoading}
          className={btnBase}
        >
          <div className="w-2 h-2 rounded-full border-2 border-[#555]" />
        </button>
      </div>

      {/* Play/Stop */}
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-2 mb-2">
          <span className="label" style={{ margin: 0, fontSize: "10px" }}>{isPlaying ? "STOP" : "PLAY"}</span>
          <div className="led-cutout">
            <div className={`led-rect ${isPlaying ? "led-green-on" : "led-green"}`} />
          </div>
        </div>
        <button
          onClick={async () => { const ctx = getAudioContext(); await ctx.resume(); if (isPlaying) { stop(); } else { play(); } }}
          disabled={!isPlaying && off}
          className={btnBase}
        >
          <div className="w-2 h-2 rounded-full border-2 border-[#555]" />
        </button>
      </div>

      {/* RDM */}
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-2 mb-2">
          <span className="label" style={{ margin: 0, fontSize: "10px" }}>RANDOM</span>
          <div className="led-cutout">
            <div className="led-rect led-green" />
          </div>
        </div>
        <button onClick={randomize} disabled={off} className={btnBase}>
          <div className="w-2 h-2 rounded-full border-2 border-[#555]" />
        </button>
      </div>

      {/* Download */}
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-2 mb-2">
          <span className="label" style={{ margin: 0, fontSize: "10px" }}>{isExporting ? "WAIT" : "DOWNLOAD"}</span>
          <div className="led-cutout">
            <div className={`led-rect ${isExporting ? "led-green-on" : "led-green"}`} />
          </div>
        </div>
        <button onClick={download} disabled={off || isExporting} className={btnBase}>
          <div className="w-2 h-2 rounded-full border-2 border-[#555]" />
        </button>
      </div>
    </div>
  );
}
