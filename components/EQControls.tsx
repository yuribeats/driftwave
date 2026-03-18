"use client";

import { useStore } from "../lib/store";

function EQSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-dw-muted uppercase tracking-wider">
        <span>{label}</span>
        <span className="text-dw-accent">
          {value > 0 ? "+" : ""}
          {value.toFixed(0)}DB
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export default function EQControls() {
  const params = useStore((s) => s.params);
  const setParam = useStore((s) => s.setParam);

  return (
    <div className="flex flex-col gap-3">
      <label className="text-xs text-dw-muted uppercase tracking-widest">
        EQ
      </label>
      <EQSlider
        label="LO"
        value={params.eqLow}
        min={-12}
        max={12}
        onChange={(v) => setParam("eqLow", v)}
      />
      <EQSlider
        label="MID"
        value={params.eqMid}
        min={-10}
        max={10}
        onChange={(v) => setParam("eqMid", v)}
      />
      <EQSlider
        label="HI"
        value={params.eqHigh}
        min={-10}
        max={10}
        onChange={(v) => setParam("eqHigh", v)}
      />
    </div>
  );
}
