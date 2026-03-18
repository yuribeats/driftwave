"use client";

import { useRef, useEffect, useCallback, useState } from "react";

interface Props {
  audioBuffer: AudioBuffer | null;
  isPlaying: boolean;
  pauseOffset: number;
  regionStart: number;
  regionEnd: number;
  onRegionChange: (start: number, end: number) => void;
  onSeek: (position: number) => void;
}

function computePeaks(buffer: AudioBuffer, numBars: number): Float32Array {
  const ch0 = buffer.getChannelData(0);
  const peaks = new Float32Array(numBars);
  const samplesPerBar = Math.floor(ch0.length / numBars);

  for (let i = 0; i < numBars; i++) {
    let max = 0;
    const start = i * samplesPerBar;
    const end = Math.min(start + samplesPerBar, ch0.length);
    for (let j = start; j < end; j++) {
      const abs = Math.abs(ch0[j]);
      if (abs > max) max = abs;
    }
    peaks[i] = max;
  }

  let globalMax = 0;
  for (let i = 0; i < numBars; i++) {
    if (peaks[i] > globalMax) globalMax = peaks[i];
  }
  if (globalMax > 0) {
    for (let i = 0; i < numBars; i++) {
      peaks[i] /= globalMax;
    }
  }

  return peaks;
}

type DragMode = "seek" | "regionStart" | "regionEnd" | null;

export default function WaveformDisplay({
  audioBuffer,
  isPlaying,
  pauseOffset,
  regionStart,
  regionEnd,
  onRegionChange,
  onSeek,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const peaksRef = useRef<Float32Array | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);

  // Zoom: viewStart/viewEnd in seconds defines the visible window
  const [zoom, setZoom] = useState(1); // 1 = full track visible
  const [viewCenter, setViewCenter] = useState(0); // center of view in seconds

  const duration = audioBuffer?.duration ?? 0;
  const effectiveStart = regionStart;
  const effectiveEnd = regionEnd > 0 ? regionEnd : duration;

  // Compute visible time window from zoom
  const viewDuration = duration / zoom;
  const halfView = viewDuration / 2;
  const clampedCenter = Math.max(halfView, Math.min(duration - halfView, viewCenter || duration / 2));
  const viewStart = Math.max(0, clampedCenter - halfView);
  const viewEnd = Math.min(duration, clampedCenter + halfView);

  // Reset zoom when buffer changes
  useEffect(() => {
    if (audioBuffer) {
      peaksRef.current = computePeaks(audioBuffer, 800);
      setZoom(1);
      setViewCenter(audioBuffer.duration / 2);
    } else {
      peaksRef.current = null;
      setZoom(1);
      setViewCenter(0);
    }
  }, [audioBuffer]);

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
    const peaks = peaksRef.current;

    ctx.fillStyle = "#0d0d0d";
    ctx.fillRect(0, 0, w, h);

    if (!peaks || !audioBuffer || duration === 0) {
      ctx.fillStyle = "#333";
      ctx.textAlign = "center";
      ctx.font = "11px monospace";
      ctx.fillText("NO TRACK LOADED", w / 2, h / 2 + 4);
      return;
    }

    const numBars = peaks.length;
    const midY = h / 2;
    const vDur = viewEnd - viewStart;
    if (vDur <= 0) return;

    // Map time to pixel
    const timeToX = (t: number) => ((t - viewStart) / vDur) * w;

    // Determine which peaks are visible
    const firstBar = Math.max(0, Math.floor((viewStart / duration) * numBars));
    const lastBar = Math.min(numBars - 1, Math.ceil((viewEnd / duration) * numBars));
    const visibleBars = lastBar - firstBar + 1;
    const barWidth = w / visibleBars;

    const hasRegion = effectiveStart > 0 || effectiveEnd < duration;

    // Draw waveform bars
    for (let i = firstBar; i <= lastBar; i++) {
      const barTime = (i / numBars) * duration;
      const x = timeToX(barTime);
      const barH = peaks[i] * midY * 0.9;
      const inRegion = barTime >= effectiveStart && barTime <= effectiveEnd;

      if (hasRegion && !inRegion) {
        ctx.fillStyle = "#1a2a1c";
      } else {
        ctx.fillStyle = "#6b8f71";
      }

      ctx.fillRect(x, midY - barH, Math.max(barWidth - 0.5, 1), barH);
      ctx.fillRect(x, midY, Math.max(barWidth - 0.5, 1), barH * 0.6);
    }

    // Dim overlay outside region
    if (hasRegion) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      const rsX = timeToX(effectiveStart);
      const reX = timeToX(effectiveEnd);
      if (rsX > 0) ctx.fillRect(0, 0, rsX, h);
      if (reX < w) ctx.fillRect(reX, 0, w - reX, h);
    }

    // Center line
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    // Region handles
    const handleSize = 10;
    const rsX = timeToX(effectiveStart);
    const reX = timeToX(effectiveEnd);

    // IN handle
    if (rsX >= -handleSize && rsX <= w + handleSize) {
      ctx.fillStyle = "#c8a96e";
      ctx.strokeStyle = "#c8a96e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rsX, 0);
      ctx.lineTo(rsX, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rsX, 0);
      ctx.lineTo(rsX + handleSize, 0);
      ctx.lineTo(rsX, handleSize);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(rsX, h);
      ctx.lineTo(rsX + handleSize, h);
      ctx.lineTo(rsX, h - handleSize);
      ctx.fill();
    }

    // OUT handle
    if (reX >= -handleSize && reX <= w + handleSize) {
      ctx.fillStyle = "#c8a96e";
      ctx.strokeStyle = "#c8a96e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(reX, 0);
      ctx.lineTo(reX, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(reX, 0);
      ctx.lineTo(reX - handleSize, 0);
      ctx.lineTo(reX, handleSize);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(reX, h);
      ctx.lineTo(reX - handleSize, h);
      ctx.lineTo(reX, h - handleSize);
      ctx.fill();
    }

    // Playback cursor
    const cursorX = timeToX(pauseOffset);
    if (cursorX >= 0 && cursorX <= w) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cursorX, 0);
      ctx.lineTo(cursorX, h);
      ctx.stroke();
    }

    // Zoom indicator
    if (zoom > 1) {
      ctx.fillStyle = "rgba(200,169,110,0.7)";
      ctx.font = "9px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${zoom.toFixed(1)}X`, w - 4, 10);
    }

    if (isPlaying) {
      animRef.current = requestAnimationFrame(draw);
    }
  }, [audioBuffer, isPlaying, pauseOffset, effectiveStart, effectiveEnd, duration, viewStart, viewEnd, zoom]);

  useEffect(() => {
    draw();
    if (isPlaying) {
      animRef.current = requestAnimationFrame(draw);
    }
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [draw, isPlaying]);

  useEffect(() => {
    if (!isPlaying) draw();
  }, [pauseOffset, isPlaying, draw]);

  // Convert pixel X to time, accounting for zoom
  const getTimeFromX = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !duration) return 0;
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const vDur = viewEnd - viewStart;
    return viewStart + (x / rect.width) * vDur;
  }, [duration, viewStart, viewEnd]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!audioBuffer) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const w = rect.width;
    const vDur = viewEnd - viewStart;
    const rsX = ((effectiveStart - viewStart) / vDur) * w;
    const reX = ((effectiveEnd - viewStart) / vDur) * w;

    if (Math.abs(x - rsX) < 16) {
      setDragMode("regionStart");
    } else if (Math.abs(x - reX) < 16) {
      setDragMode("regionEnd");
    } else {
      setDragMode("seek");
      onSeek(getTimeFromX(e.clientX));
    }

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [audioBuffer, effectiveStart, effectiveEnd, viewStart, viewEnd, getTimeFromX, onSeek]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragMode || !audioBuffer) return;
    e.stopPropagation();
    e.preventDefault();
    const t = getTimeFromX(e.clientX);

    if (dragMode === "seek") {
      onSeek(t);
    } else if (dragMode === "regionStart") {
      const maxStart = effectiveEnd - 0.1;
      onRegionChange(Math.max(0, Math.min(t, maxStart)), regionEnd);
    } else if (dragMode === "regionEnd") {
      const minEnd = effectiveStart + 0.1;
      const newEnd = Math.min(duration, Math.max(t, minEnd));
      onRegionChange(regionStart, newEnd);
    }
  }, [dragMode, audioBuffer, getTimeFromX, onSeek, onRegionChange, regionStart, regionEnd, effectiveStart, effectiveEnd, duration]);

  const handlePointerUp = useCallback(() => {
    setDragMode(null);
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (!audioBuffer) return;
    onRegionChange(0, 0);
  }, [audioBuffer, onRegionChange]);

  const zoomIn = useCallback(() => {
    if (!audioBuffer) return;
    // Center on region midpoint when zooming
    const regionMid = (effectiveStart + effectiveEnd) / 2;
    setViewCenter(regionMid);
    setZoom((z) => Math.min(64, z * 1.5));
  }, [audioBuffer, effectiveStart, effectiveEnd]);

  const zoomOut = useCallback(() => {
    if (!audioBuffer) return;
    const regionMid = (effectiveStart + effectiveEnd) / 2;
    setViewCenter(regionMid);
    setZoom((z) => Math.max(1, z / 1.5));
  }, [audioBuffer, effectiveStart, effectiveEnd]);

  // Keyboard: + to zoom in, - to zoom out
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!audioBuffer) return;
      if (e.key === "=" || e.key === "+") { e.preventDefault(); zoomIn(); }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomOut(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [audioBuffer, zoomIn, zoomOut]);

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={containerRef}
        style={{ height: "80px", touchAction: "none", background: "#0d0d0d", borderRadius: "2px", overflow: "hidden" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
      {audioBuffer && (
        <div className="flex items-center gap-2 justify-end">
          <span className="text-[8px]" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)" }}>
            {zoom > 1 ? `${zoom.toFixed(1)}X` : "1X"}
          </span>
          <button
            onClick={zoomOut}
            disabled={zoom <= 1}
            className="text-[10px] px-1.5 py-0 border border-[#555]"
            style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", background: "transparent", lineHeight: "16px" }}
          >
            −
          </button>
          <button
            onClick={zoomIn}
            className="text-[10px] px-1.5 py-0 border border-[#555]"
            style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", background: "transparent", lineHeight: "16px" }}
          >
            +
          </button>
          <span className="text-[7px]" style={{ color: "#555", fontFamily: "var(--font-tech)" }}>
            OR +/− KEYS
          </span>
        </div>
      )}
    </div>
  );
}
