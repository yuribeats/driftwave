"use client";

import { useStore } from "../lib/store";

export default function SpeedPitchSlider() {
  const rate = useStore((s) => s.params.rate);
  const setParam = useStore((s) => s.setParam);

  const semitones = 12 * Math.log2(rate);

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-dw-muted uppercase tracking-widest">
        SPEED / PITCH
      </label>
      <input
        type="range"
        min={0.5}
        max={1.0}
        step={0.01}
        value={rate}
        onChange={(e) => setParam("rate", parseFloat(e.target.value))}
      />
      <div className="flex justify-between text-xs text-dw-accent font-mono">
        <span>{rate.toFixed(2)}X</span>
        <span>{semitones.toFixed(1)}ST</span>
      </div>
    </div>
  );
}
