"use client";

import { useRef, useEffect, useCallback, useState } from "react";

interface AutomationPoint {
  time: number;
  value: number;
}

interface Props {
  enabled: boolean;
  points: AutomationPoint[];
  duration: number;
  regionStart: number;
  regionEnd: number;
  onToggle: () => void;
  onAddPoint: (time: number, value: number) => void;
  onRemovePoint: (index: number) => void;
  onMovePoint: (index: number, time: number, value: number) => void;
}

const POINT_RADIUS = 5;
const LANE_HEIGHT = 60;

export default function VolumeAutomation({
  enabled,
  points,
  duration,
  regionStart,
  regionEnd,
  onToggle,
  onAddPoint,
  onRemovePoint,
  onMovePoint,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const effectiveEnd = regionEnd > 0 ? regionEnd : duration;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    // Background
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, w, h);

    if (!enabled || duration === 0) {
      ctx.fillStyle = "#333";
      ctx.textAlign = "center";
      ctx.font = "9px monospace";
      ctx.fillText(enabled ? "CLICK TO ADD POINTS" : "OFF", w / 2, h / 2 + 3);
      return;
    }

    const timeToX = (t: number) => ((t - regionStart) / (effectiveEnd - regionStart)) * w;
    const valueToY = (v: number) => h - v * h;

    // Grid lines at 25%, 50%, 75%
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 0.5;
    for (const pct of [0.25, 0.5, 0.75]) {
      const y = valueToY(pct);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Unity line (100%)
    ctx.strokeStyle = "#2a2a2a";
    ctx.setLineDash([4, 4]);
    const unityY = valueToY(1);
    ctx.beginPath();
    ctx.moveTo(0, unityY);
    ctx.lineTo(w, unityY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw automation line
    if (points.length > 0) {
      ctx.strokeStyle = "var(--accent-gold, #c8a96e)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      // Start from left edge
      const firstX = timeToX(points[0].time);
      if (firstX > 0) {
        ctx.moveTo(0, valueToY(points[0].value));
        ctx.lineTo(firstX, valueToY(points[0].value));
      } else {
        ctx.moveTo(firstX, valueToY(points[0].value));
      }

      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(timeToX(points[i].time), valueToY(points[i].value));
      }

      // Extend to right edge
      const lastX = timeToX(points[points.length - 1].time);
      if (lastX < w) {
        ctx.lineTo(w, valueToY(points[points.length - 1].value));
      }

      ctx.stroke();

      // Draw points
      for (let i = 0; i < points.length; i++) {
        const px = timeToX(points[i].time);
        const py = valueToY(points[i].value);
        ctx.fillStyle = dragging === i ? "#fff" : "var(--accent-gold, #c8a96e)";
        ctx.beginPath();
        ctx.arc(px, py, POINT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    } else {
      // No points — draw unity line
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, valueToY(1));
      ctx.lineTo(w, valueToY(1));
      ctx.stroke();
    }

    // Labels
    ctx.fillStyle = "#555";
    ctx.font = "8px monospace";
    ctx.textAlign = "left";
    ctx.fillText("100%", 2, unityY + 10);
    ctx.fillText("0%", 2, h - 2);
  }, [enabled, points, duration, regionStart, effectiveEnd, dragging]);

  useEffect(() => {
    draw();
  }, [draw]);

  const getTimeAndValue = useCallback((clientX: number, clientY: number): { time: number; value: number } => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || duration === 0) return { time: 0, value: 1 };
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(clientY - rect.top, rect.height));
    const time = regionStart + (x / rect.width) * (effectiveEnd - regionStart);
    const value = Math.max(0, Math.min(1, 1 - y / rect.height));
    return { time, value };
  }, [duration, regionStart, effectiveEnd]);

  const findPointAt = useCallback((clientX: number, clientY: number): number => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return -1;
    const w = rect.width;
    const h = rect.height;
    for (let i = 0; i < points.length; i++) {
      const px = ((points[i].time - regionStart) / (effectiveEnd - regionStart)) * w + rect.left;
      const py = (1 - points[i].value) * h + rect.top;
      const dx = clientX - px;
      const dy = clientY - py;
      if (Math.sqrt(dx * dx + dy * dy) < POINT_RADIUS * 2.5) return i;
    }
    return -1;
  }, [points, regionStart, effectiveEnd]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!enabled || duration === 0) return;
    e.preventDefault();
    e.stopPropagation();

    const hitIdx = findPointAt(e.clientX, e.clientY);
    if (hitIdx >= 0) {
      setDragging(hitIdx);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } else {
      const { time, value } = getTimeAndValue(e.clientX, e.clientY);
      onAddPoint(time, value);
    }
  }, [enabled, duration, findPointAt, getTimeAndValue, onAddPoint]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging === null) return;
    e.preventDefault();
    const { time, value } = getTimeAndValue(e.clientX, e.clientY);
    onMovePoint(dragging, time, value);
  }, [dragging, getTimeAndValue, onMovePoint]);

  const handlePointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!enabled) return;
    const hitIdx = findPointAt(e.clientX, e.clientY);
    if (hitIdx >= 0) {
      onRemovePoint(hitIdx);
    }
  }, [enabled, findPointAt, onRemovePoint]);

  const btnStyle: React.CSSProperties = {
    fontFamily: "var(--font-tech)",
    color: enabled ? "var(--accent-gold)" : "var(--text-dark)",
    background: "transparent",
    fontSize: "8px",
    border: enabled ? "1px solid var(--accent-gold)" : "1px solid #555",
    padding: "2px 6px",
    letterSpacing: "0.15em",
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <button onClick={onToggle} style={btnStyle}>
          {enabled ? "AUTO: ON" : "AUTO: OFF"}
        </button>
        {enabled && points.length > 0 && (
          <span className="text-[7px]" style={{ color: "#555", fontFamily: "var(--font-tech)" }}>
            {points.length} POINT{points.length !== 1 ? "S" : ""} — DOUBLE-CLICK TO DELETE
          </span>
        )}
      </div>
      <div
        ref={containerRef}
        style={{
          height: `${LANE_HEIGHT}px`,
          touchAction: "none",
          background: "#0a0a0a",
          overflow: "hidden",
          display: enabled ? "block" : "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
    </div>
  );
}
