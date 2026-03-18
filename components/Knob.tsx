"use client";

import { useRef, useCallback, useEffect, useState } from "react";

interface KnobProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  valueDisplay: string;
  onChange: (value: number) => void;
  ticks?: number;
}

const MIN_ANGLE = -135;
const MAX_ANGLE = 135;

export default function Knob({
  value,
  min,
  max,
  step = 0.01,
  label,
  valueDisplay,
  onChange,
  ticks = 11,
}: KnobProps) {
  const knobRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startValue = useRef(0);
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const normalized = (localValue - min) / (max - min);
  const angle = MIN_ANGLE + normalized * (MAX_ANGLE - MIN_ANGLE);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startValue.current = localValue;
      document.body.style.userSelect = "none";
    },
    [localValue]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const deltaY = startY.current - e.clientY;
      const range = max - min;
      const sensitivity = 200;
      let newValue = startValue.current + (deltaY / sensitivity) * range;
      newValue = Math.round(newValue / step) * step;
      newValue = Math.max(min, Math.min(max, newValue));
      setLocalValue(newValue);
      onChange(newValue);
    };

    const handleMouseUp = () => {
      dragging.current = false;
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [min, max, step, onChange]);

  useEffect(() => {
    const el = knobRef.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.touches[0].clientY;
      startValue.current = localValue;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!dragging.current) return;
      const deltaY = startY.current - e.touches[0].clientY;
      const range = max - min;
      const sensitivity = 200;
      let newValue = startValue.current + (deltaY / sensitivity) * range;
      newValue = Math.round(newValue / step) * step;
      newValue = Math.max(min, Math.min(max, newValue));
      setLocalValue(newValue);
      onChange(newValue);
    };

    const handleTouchEnd = () => {
      dragging.current = false;
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: false });
    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchend", handleTouchEnd);
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [localValue, min, max, step, onChange]);

  const tickMarks = [];
  for (let i = 0; i < ticks; i++) {
    const t = i / (ticks - 1);
    const tickAngle = MIN_ANGLE + t * (MAX_ANGLE - MIN_ANGLE);
    const rad = ((tickAngle - 90) * Math.PI) / 180;
    const r = 42;
    const x = 48 + r * Math.cos(rad);
    const y = 48 + r * Math.sin(rad);
    tickMarks.push(
      <div
        key={i}
        className="absolute w-[2px] h-[8px]"
        style={{
          left: `${x}px`,
          top: `${y}px`,
          transform: `translate(-50%, -50%) rotate(${tickAngle}deg)`,
          background: i === 0 || i === ticks - 1 ? "#e89030" : "#888",
        }}
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-[10px] text-dw-aluminum-light uppercase tracking-[0.2em] font-bold">
        {label}
      </span>
      <div className="relative w-[96px] h-[96px]" ref={knobRef}>
        {tickMarks}
        {/* Outer ring - chrome bezel */}
        <div
          className="absolute inset-[6px] rounded-full"
          style={{
            background: "linear-gradient(180deg, #d0d0d0 0%, #888 50%, #a0a0a0 100%)",
            boxShadow: "0 3px 10px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.4)",
          }}
        >
          {/* Chrome sunburst knob body */}
          <div
            className="absolute inset-[3px] rounded-full chrome-knob"
            style={{ transform: `rotate(${angle}deg)` }}
            onMouseDown={handleMouseDown}
          >
            {/* Pointer notch */}
            <div
              className="absolute top-[3px] left-1/2 -translate-x-1/2 w-[3px] h-[14px]"
              style={{ background: "#e89030", boxShadow: "0 0 4px rgba(232,144,48,0.5)" }}
            />
            {/* Center cap */}
            <div
              className="absolute inset-[14px] rounded-full"
              style={{
                background: "radial-gradient(circle at 40% 35%, #e0e0e0, #999 60%, #777)",
                boxShadow: "inset 0 1px 3px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.2)",
              }}
            />
          </div>
        </div>
      </div>
      <span className="text-[11px] text-dw-amber font-mono tracking-wider">
        {valueDisplay}
      </span>
    </div>
  );
}
