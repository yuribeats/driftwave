"use client";

import Knob from "./Knob";
import { useStore } from "../lib/store";

function PanelScrew() {
  return (
    <div className="w-[10px] h-[10px] rounded-full bg-gradient-to-br from-[#555] to-[#333] shadow-[inset_0_1px_2px_rgba(0,0,0,0.5),0_1px_0_rgba(255,255,255,0.05)]">
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-[6px] h-[1px] bg-[#222]" />
      </div>
    </div>
  );
}

export default function Controls() {
  const sourceBuffer = useStore((s) => s.sourceBuffer);
  const params = useStore((s) => s.params);
  const setParam = useStore((s) => s.setParam);

  if (!sourceBuffer) return null;

  const semitones = 12 * Math.log2(params.rate);

  return (
    <div className="relative bg-gradient-to-b from-[#3a3a3e] to-[#2a2a2e] border border-[#1a1a1a] shadow-[0_4px_16px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[rgba(255,255,255,0.08)] to-transparent" />
      <div className="absolute top-3 left-3"><PanelScrew /></div>
      <div className="absolute top-3 right-3"><PanelScrew /></div>
      <div className="absolute bottom-3 left-3"><PanelScrew /></div>
      <div className="absolute bottom-3 right-3"><PanelScrew /></div>

      <div className="px-8 py-6">
        <div className="flex items-center justify-center gap-12 sm:gap-20">
          <Knob
            value={params.rate}
            min={0.5}
            max={1.0}
            step={0.01}
            label="SPEED / PITCH"
            valueDisplay={`${params.rate.toFixed(2)}X / ${semitones.toFixed(1)}ST`}
            onChange={(v) => setParam("rate", v)}
          />

          <div className="hidden sm:block w-[1px] h-[100px] bg-[#1a1a1a] shadow-[1px_0_0_rgba(255,255,255,0.04)]" />

          <Knob
            value={params.reverb}
            min={0}
            max={1}
            step={0.01}
            label="REVERB"
            valueDisplay={`${Math.round(params.reverb * 100)}%`}
            onChange={(v) => setParam("reverb", v)}
          />

          <div className="hidden sm:block w-[1px] h-[100px] bg-[#1a1a1a] shadow-[1px_0_0_rgba(255,255,255,0.04)]" />

          <Knob
            value={params.tone}
            min={-1}
            max={1}
            step={0.01}
            label="TONE"
            valueDisplay={params.tone === 0 ? "FLAT" : params.tone < 0 ? "DARK" : "BRIGHT"}
            onChange={(v) => setParam("tone", v)}
          />
        </div>
      </div>
    </div>
  );
}
