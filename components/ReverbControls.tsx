"use client";

import { useStore } from "../lib/store";

export default function ReverbControls() {
  const params = useStore((s) => s.params);
  const setParam = useStore((s) => s.setParam);

  return (
    <div className="flex flex-col gap-3">
      <label className="text-xs text-dw-muted uppercase tracking-widest">
        REVERB
      </label>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-xs text-dw-muted uppercase tracking-wider">
          <span>WET</span>
          <span className="text-dw-accent">{Math.round(params.reverbWet * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={params.reverbWet}
          onChange={(e) => setParam("reverbWet", parseFloat(e.target.value))}
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-xs text-dw-muted uppercase tracking-wider">
          <span>SIZE</span>
          <span className="text-dw-accent">{params.reverbDuration.toFixed(1)}S</span>
        </div>
        <input
          type="range"
          min={1}
          max={6}
          step={0.1}
          value={params.reverbDuration}
          onChange={(e) =>
            setParam("reverbDuration", parseFloat(e.target.value))
          }
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-xs text-dw-muted uppercase tracking-wider">
          <span>DECAY</span>
          <span className="text-dw-accent">{params.reverbDecay.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min={1}
          max={5}
          step={0.1}
          value={params.reverbDecay}
          onChange={(e) => setParam("reverbDecay", parseFloat(e.target.value))}
        />
      </div>
    </div>
  );
}
