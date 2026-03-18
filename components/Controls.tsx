"use client";

import { useState } from "react";
import Knob from "./Knob";
import { useStore } from "../lib/store";

function PanelScrew() {
  return (
    <div className="w-[10px] h-[10px] rounded-full panel-screw">
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-[6px] h-[1px] bg-[#111]" />
      </div>
    </div>
  );
}

function snapToSemitone(speed: number): number {
  const rate = 1.0 + speed;
  const semitones = 12 * Math.log2(rate);
  const snapped = Math.round(semitones);
  return Math.pow(2, snapped / 12) - 1.0;
}

export default function Controls() {
  const params = useStore((s) => s.params);
  const setParam = useStore((s) => s.setParam);
  const [stepMode, setStepMode] = useState(false);

  const rate = 1.0 + params.speed;
  const semitones = 12 * Math.log2(rate);

  const handleSpeed = (v: number) => {
    if (stepMode) {
      setParam("speed", snapToSemitone(v));
    } else {
      setParam("speed", v);
    }
  };

  return (
    <div className="wood-grain p-[6px]">
      <div className="relative brushed-aluminum border border-[#666] shadow-[0_2px_12px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.3)]">
        {/* Top highlight line */}
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[rgba(255,255,255,0.3)] to-transparent" />

        <div className="absolute top-3 left-3"><PanelScrew /></div>
        <div className="absolute top-3 right-3"><PanelScrew /></div>
        <div className="absolute bottom-3 left-3"><PanelScrew /></div>
        <div className="absolute bottom-3 right-3"><PanelScrew /></div>

        <div className="px-8 py-8">
          <div className="flex items-center justify-center gap-12 sm:gap-20">
            <div className="flex flex-col items-center gap-0">
              <Knob
                value={params.speed}
                min={-0.5}
                max={0.5}
                step={stepMode ? 0.001 : 0.01}
                label="SPEED / PITCH"
                valueDisplay={`${rate.toFixed(2)}X / ${semitones >= 0 ? "+" : ""}${semitones.toFixed(1)}ST`}
                onChange={handleSpeed}
              />
              <button
                onClick={() => setStepMode(!stepMode)}
                className={`mt-1 text-[8px] uppercase tracking-[0.15em] font-mono px-2 py-0.5 border ${
                  stepMode
                    ? "text-dw-amber border-dw-amber"
                    : "text-[#666] border-[#666]"
                } hover:text-dw-amber`}
              >
                STEP
              </button>
            </div>

            <div className="hidden sm:block w-[1px] h-[120px] bg-[#777] shadow-[1px_0_0_rgba(255,255,255,0.1)]" />

            <Knob
              value={params.reverb}
              min={0}
              max={1}
              step={0.01}
              label="REVERB"
              valueDisplay={`${Math.round(params.reverb * 100)}%`}
              onChange={(v) => setParam("reverb", v)}
            />

            <div className="hidden sm:block w-[1px] h-[120px] bg-[#777] shadow-[1px_0_0_rgba(255,255,255,0.1)]" />

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
    </div>
  );
}
