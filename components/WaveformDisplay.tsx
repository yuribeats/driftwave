"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { getAudioContext } from "../lib/audio-context";

interface Props {
  audioBuffer: AudioBuffer | null;
  isPlaying: boolean;
  pauseOffset: number;
  startedAt: number;
  playbackRate: number;
  regionStart: number;
  regionEnd: number;
  onRegionChange: (start: number, end: number) => void;
  onSeek: (position: number) => void;
  onScrub?: (position: number) => void; // lightweight visual-only update during drag
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

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

type DragMode = "playhead" | "regionStart" | "regionEnd" | "pan" | null;

export default function WaveformDisplay({
  audioBuffer,
  isPlaying,
  pauseOffset,
  startedAt,
  playbackRate,
  regionStart,
  regionEnd,
  onRegionChange,
  onSeek,
  onScrub,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const peaksRef = useRef<Float32Array | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const panStartRef = useRef<{ viewCenter: number; clientX: number } | null>(null);

  const [zoom, setZoom] = useState(1);
  const [viewCenter, setViewCenter] = useState(0);

  const duration = audioBuffer?.duration ?? 0;
  const effectiveStart = regionStart;
  const effectiveEnd = regionEnd > 0 ? regionEnd : duration;

  const viewDuration = duration / zoom;
  const halfView = viewDuration / 2;
  const clampedCenter = Math.max(halfView, Math.min(duration - halfView, viewCenter || duration / 2));
  const viewStart = Math.max(0, clampedCenter - halfView);
  const viewEnd = Math.min(duration, clampedCenter + halfView);

  useEffect(() => {
    if (audioBuffer) {
      peaksRef.current = computePeaks(audioBuffer, 2000);
      setZoom(1);
      setViewCenter(audioBuffer.duration / 2);
    } else {
      peaksRef.current = null;
      setZoom(1);
      setViewCenter(0);
    }
  }, [audioBuffer]);

  // Compute live cursor time
  const getCursorTime = useCallback(() => {
    if (!isPlaying) return pauseOffset;
    try {
      const ctx = getAudioContext();
      const elapsed = (ctx.currentTime - startedAt) * playbackRate;
      const pos = regionStart + elapsed;
      // Wrap within region for looping
      const rEnd = regionEnd > 0 ? regionEnd : duration;
      const rLen = rEnd - regionStart;
      if (rLen > 0 && pos > rEnd) {
        return regionStart + ((pos - regionStart) % rLen);
      }
      return pos;
    } catch {
      return pauseOffset;
    }
  }, [isPlaying, pauseOffset, startedAt, playbackRate, regionStart, regionEnd, duration]);

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
    const RULER_H = 18;
    const waveH = h - RULER_H;

    // Background
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, w, h);

    if (!peaks || !audioBuffer || duration === 0) {
      ctx.fillStyle = "#333";
      ctx.textAlign = "center";
      ctx.font = "11px monospace";
      ctx.fillText("NO TRACK LOADED", w / 2, h / 2 + 4);
      return;
    }

    const numBars = peaks.length;
    const midY = waveH / 2;
    const vDur = viewEnd - viewStart;
    if (vDur <= 0) return;

    const timeToX = (t: number) => ((t - viewStart) / vDur) * w;

    const firstBar = Math.max(0, Math.floor((viewStart / duration) * numBars));
    const lastBar = Math.min(numBars - 1, Math.ceil((viewEnd / duration) * numBars));
    const visibleBars = lastBar - firstBar + 1;
    const barWidth = w / visibleBars;

    const hasRegion = effectiveStart > 0 || effectiveEnd < duration;

    // Draw waveform bars
    for (let i = firstBar; i <= lastBar; i++) {
      const barTime = (i / numBars) * duration;
      const x = timeToX(barTime);
      const barH = peaks[i] * midY * 0.88;
      const inRegion = barTime >= effectiveStart && barTime <= effectiveEnd;

      if (hasRegion && !inRegion) {
        ctx.fillStyle = "#1a2a1c";
      } else {
        ctx.fillStyle = "#6b8f71";
      }

      ctx.fillRect(x, midY - barH, Math.max(barWidth - 0.5, 1), barH);
      ctx.fillRect(x, midY, Math.max(barWidth - 0.5, 1), barH * 0.6);
    }

    // Dim outside region
    if (hasRegion) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      const rsX = timeToX(effectiveStart);
      const reX = timeToX(effectiveEnd);
      if (rsX > 0) ctx.fillRect(0, 0, rsX, waveH);
      if (reX < w) ctx.fillRect(reX, 0, w - reX, waveH);
    }

    // Center line
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    // Region handles
    const handleSize = 12;
    const rsX = timeToX(effectiveStart);
    const reX = timeToX(effectiveEnd);

    // IN handle
    if (rsX >= -handleSize && rsX <= w + handleSize) {
      ctx.fillStyle = "#c8a96e";
      ctx.strokeStyle = "#c8a96e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rsX, 0);
      ctx.lineTo(rsX, waveH);
      ctx.stroke();
      // Top bracket
      ctx.fillRect(rsX, 0, handleSize, 3);
      ctx.fillRect(rsX, 0, 3, handleSize);
      // Bottom bracket
      ctx.fillRect(rsX, waveH - 3, handleSize, 3);
      ctx.fillRect(rsX, waveH - handleSize, 3, handleSize);
      // IN label
      ctx.fillStyle = "#c8a96e";
      ctx.font = "bold 8px monospace";
      ctx.textAlign = "left";
      ctx.fillText("IN", rsX + 4, 14);
    }

    // OUT handle
    if (reX >= -handleSize && reX <= w + handleSize) {
      ctx.fillStyle = "#c8a96e";
      ctx.strokeStyle = "#c8a96e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(reX, 0);
      ctx.lineTo(reX, waveH);
      ctx.stroke();
      // Top bracket
      ctx.fillRect(reX - handleSize, 0, handleSize, 3);
      ctx.fillRect(reX - 3, 0, 3, handleSize);
      // Bottom bracket
      ctx.fillRect(reX - handleSize, waveH - 3, handleSize, 3);
      ctx.fillRect(reX - 3, waveH - handleSize, 3, handleSize);
      // OUT label
      ctx.fillStyle = "#c8a96e";
      ctx.font = "bold 8px monospace";
      ctx.textAlign = "right";
      ctx.fillText("OUT", reX - 4, 14);
    }

    // ── Time ruler ──
    ctx.fillStyle = "#151515";
    ctx.fillRect(0, waveH, w, RULER_H);
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, waveH);
    ctx.lineTo(w, waveH);
    ctx.stroke();

    // Choose tick interval based on visible duration
    let tickInterval: number;
    if (vDur <= 2) tickInterval = 0.1;
    else if (vDur <= 5) tickInterval = 0.25;
    else if (vDur <= 15) tickInterval = 0.5;
    else if (vDur <= 30) tickInterval = 1;
    else if (vDur <= 60) tickInterval = 2;
    else if (vDur <= 120) tickInterval = 5;
    else if (vDur <= 300) tickInterval = 10;
    else tickInterval = 30;

    const firstTick = Math.ceil(viewStart / tickInterval) * tickInterval;
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    for (let t = firstTick; t <= viewEnd; t += tickInterval) {
      const tx = timeToX(t);
      // Major tick
      ctx.strokeStyle = "#3a3a3a";
      ctx.beginPath();
      ctx.moveTo(tx, waveH);
      ctx.lineTo(tx, waveH + 6);
      ctx.stroke();
      // Label
      ctx.fillStyle = "#555";
      const m = Math.floor(t / 60);
      const s = (t % 60).toFixed(vDur <= 5 ? 1 : 0);
      ctx.fillText(`${m}:${parseFloat(s).toFixed(vDur <= 5 ? 1 : 0).padStart(vDur <= 5 ? 4 : 2, "0")}`, tx, waveH + 14);
    }

    // ── Playhead ──
    const cursorTime = getCursorTime();
    const cursorX = timeToX(cursorTime);
    if (cursorX >= -5 && cursorX <= w + 5) {
      // Glow
      ctx.shadowColor = "rgba(255,255,255,0.3)";
      ctx.shadowBlur = 6;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cursorX, 0);
      ctx.lineTo(cursorX, waveH);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Top triangle handle
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(cursorX, 0);
      ctx.lineTo(cursorX - 5, -1);
      ctx.lineTo(cursorX + 5, -1);
      ctx.closePath();
      ctx.fill();

      // Bottom triangle handle
      ctx.beginPath();
      ctx.moveTo(cursorX, waveH);
      ctx.lineTo(cursorX - 5, waveH + 1);
      ctx.lineTo(cursorX + 5, waveH + 1);
      ctx.closePath();
      ctx.fill();

      // Time at cursor on ruler
      ctx.fillStyle = "#fff";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      const cm = Math.floor(cursorTime / 60);
      const cs = (cursorTime % 60).toFixed(1);
      ctx.fillText(`${cm}:${parseFloat(cs).toFixed(1).padStart(4, "0")}`, Math.max(20, Math.min(w - 20, cursorX)), waveH + 14);
    }

    // Zoom indicator
    if (zoom > 1) {
      ctx.fillStyle = "rgba(200,169,110,0.7)";
      ctx.font = "9px monospace";
      ctx.textAlign = "right";
      ctx.shadowBlur = 0;
      ctx.fillText(`${zoom.toFixed(1)}X`, w - 4, 10);
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBuffer, effectiveStart, effectiveEnd, duration, viewStart, viewEnd, zoom, getCursorTime]);

  // Animation loop — only useEffect controls scheduling, draw never self-schedules
  useEffect(() => {
    let frameId: number | null = null;
    const animate = () => {
      draw();
      if (isPlaying) {
        frameId = requestAnimationFrame(animate);
      }
    };
    animate();
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [draw, isPlaying]);

  useEffect(() => {
    if (!isPlaying) draw();
  }, [pauseOffset, isPlaying, draw]);

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

    // Playhead position
    const cursorTime = getCursorTime();
    const cursorX = ((cursorTime - viewStart) / vDur) * w;

    // Check hit priority: region handles > playhead > seek
    if (Math.abs(x - rsX) < 16) {
      setDragMode("regionStart");
    } else if (Math.abs(x - reX) < 16) {
      setDragMode("regionEnd");
    } else if (Math.abs(x - cursorX) < 12) {
      setDragMode("playhead");
    } else if (e.shiftKey && zoom > 1) {
      // Shift+drag to pan
      setDragMode("pan");
      panStartRef.current = { viewCenter: clampedCenter, clientX: e.clientX };
    } else {
      setDragMode("playhead");
      onSeek(getTimeFromX(e.clientX));
    }

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [audioBuffer, effectiveStart, effectiveEnd, viewStart, viewEnd, getTimeFromX, onSeek, getCursorTime, zoom, clampedCenter]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragMode || !audioBuffer) return;
    e.stopPropagation();
    e.preventDefault();

    if (dragMode === "pan" && panStartRef.current) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = e.clientX - panStartRef.current.clientX;
      const timeDelta = -(dx / rect.width) * (viewEnd - viewStart);
      setViewCenter(panStartRef.current.viewCenter + timeDelta);
      return;
    }

    const t = getTimeFromX(e.clientX);

    if (dragMode === "playhead") {
      handleScrubInternal(t);
      return;
    } else if (dragMode === "regionStart") {
      const maxStart = effectiveEnd - 0.05;
      onRegionChange(Math.max(0, Math.min(t, maxStart)), regionEnd);
    } else if (dragMode === "regionEnd") {
      const minEnd = effectiveStart + 0.05;
      const newEnd = Math.min(duration, Math.max(t, minEnd));
      onRegionChange(regionStart, newEnd);
    }
  }, [dragMode, audioBuffer, getTimeFromX, onSeek, onRegionChange, regionStart, regionEnd, effectiveStart, effectiveEnd, duration, viewStart, viewEnd]);

  const lastScrubRef = useRef<number | null>(null);

  // Track scrub position
  const handleScrubInternal = useCallback((t: number) => {
    lastScrubRef.current = t;
    if (onScrub) onScrub(t);
    else onSeek(t);
  }, [onScrub, onSeek]);

  const handlePointerUp = useCallback(() => {
    // Commit scrub position on release
    if (dragMode === "playhead" && lastScrubRef.current !== null) {
      onSeek(lastScrubRef.current);
      lastScrubRef.current = null;
    }
    setDragMode(null);
    panStartRef.current = null;
  }, [dragMode, onSeek]);

  const handleDoubleClick = useCallback(() => {
    if (!audioBuffer) return;
    onRegionChange(0, 0);
  }, [audioBuffer, onRegionChange]);

  const zoomIn = useCallback(() => {
    if (!audioBuffer) return;
    const regionMid = (effectiveStart + effectiveEnd) / 2;
    setViewCenter(regionMid);
    setZoom((z) => Math.min(128, z * 1.5));
  }, [audioBuffer, effectiveStart, effectiveEnd]);

  const zoomOut = useCallback(() => {
    if (!audioBuffer) return;
    const regionMid = (effectiveStart + effectiveEnd) / 2;
    setViewCenter(regionMid);
    setZoom((z) => Math.max(1, z / 1.5));
  }, [audioBuffer, effectiveStart, effectiveEnd]);

  const zoomToRegion = useCallback(() => {
    if (!audioBuffer || !duration) return;
    const rLen = effectiveEnd - effectiveStart;
    if (rLen <= 0) return;
    const newZoom = Math.min(128, duration / rLen);
    const regionMid = (effectiveStart + effectiveEnd) / 2;
    setViewCenter(regionMid);
    setZoom(newZoom);
  }, [audioBuffer, duration, effectiveStart, effectiveEnd]);

  // Keyboard: + to zoom in, - to zoom out, F to fit region
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!audioBuffer) return;
      if (e.key === "=" || e.key === "+") { e.preventDefault(); zoomIn(); }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomOut(); }
      if (e.key === "f" || e.key === "F") { e.preventDefault(); zoomToRegion(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [audioBuffer, zoomIn, zoomOut, zoomToRegion]);

  // Region duration
  const regionDuration = effectiveEnd - effectiveStart;
  const cursorDisplay = getCursorTime();

  return (
    <div className="flex flex-col gap-1">
      {/* Time readout */}
      {audioBuffer && (
        <div className="flex items-center justify-between px-1">
          <span className="text-[9px]" style={{ color: "var(--crt-bright)", fontFamily: "var(--font-crt)", fontSize: "12px", textShadow: "0 0 4px var(--crt-dim)" }}>
            {formatTime(cursorDisplay)}
          </span>
          <span className="text-[9px]" style={{ color: "var(--crt-dim)", fontFamily: "var(--font-crt)", fontSize: "11px" }}>
            LOOP: {formatTime(regionDuration)}
          </span>
          <span className="text-[9px]" style={{ color: "#555", fontFamily: "var(--font-crt)", fontSize: "11px" }}>
            {formatTime(duration)}
          </span>
        </div>
      )}

      {/* Waveform canvas */}
      <div
        ref={containerRef}
        style={{ height: "120px", touchAction: "none", background: "#0a0a0a", borderRadius: "2px", overflow: "hidden" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>

      {/* Controls row */}
      {audioBuffer && (
        <div className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-1">
            <span className="text-[8px]" style={{ color: "#555", fontFamily: "var(--font-tech)" }}>
              {zoom > 1 ? "SHIFT+DRAG TO PAN" : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={zoomToRegion}
              className="text-[9px] px-1.5 py-0 border border-[#555]"
              style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", background: "transparent", lineHeight: "16px" }}
            >
              FIT
            </button>
            <button
              onClick={zoomOut}
              disabled={zoom <= 1}
              className="text-[9px] px-1.5 py-0 border border-[#555]"
              style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", background: "transparent", lineHeight: "16px" }}
            >
              −
            </button>
            <span className="text-[8px]" style={{ color: "var(--text-dark)", fontFamily: "var(--font-tech)" }}>
              {zoom > 1 ? `${zoom.toFixed(1)}X` : "1X"}
            </span>
            <button
              onClick={zoomIn}
              className="text-[9px] px-1.5 py-0 border border-[#555]"
              style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", background: "transparent", lineHeight: "16px" }}
            >
              +
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
