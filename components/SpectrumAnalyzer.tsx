"use client";

import { useRef, useEffect, useCallback } from "react";
import { useStore } from "../lib/store";

const BAR_COUNT = 32;
const BAR_GAP = 2;

export default function SpectrumAnalyzer() {
  const sourceBuffer = useStore((s) => s.sourceBuffer);
  const isPlaying = useStore((s) => s.isPlaying);
  const nodes = useStore((s) => s.nodes);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const peaksRef = useRef<number[]>(new Array(BAR_COUNT).fill(0));

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

    const width = rect.width;
    const height = rect.height;

    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = "rgba(100, 200, 100, 0.06)";
    ctx.lineWidth = 1;
    for (let y = 0; y < height; y += 12) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const barWidth = (width - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT;
    const freqData = new Uint8Array(128);

    if (nodes?.analyser && isPlaying) {
      nodes.analyser.getByteFrequencyData(freqData);
    }

    for (let i = 0; i < BAR_COUNT; i++) {
      // Map bars to frequency bins (logarithmic-ish)
      const binIndex = Math.floor(Math.pow(i / BAR_COUNT, 1.5) * freqData.length);
      const value = freqData[binIndex] || 0;
      const normalized = value / 255;
      const x = i * (barWidth + BAR_GAP);

      // Draw segmented bar (LED style)
      const segmentHeight = 4;
      const segmentGap = 1;
      const totalSegments = Math.floor(height / (segmentHeight + segmentGap));
      const activeSegments = Math.floor(normalized * totalSegments);

      for (let s = 0; s < activeSegments; s++) {
        const segY = height - (s + 1) * (segmentHeight + segmentGap);
        const ratio = s / totalSegments;

        // Green → Yellow → Red
        let r, g, b;
        if (ratio < 0.6) {
          r = 40;
          g = 200;
          b = 40;
        } else if (ratio < 0.8) {
          r = 220;
          g = 200;
          b = 40;
        } else {
          r = 220;
          g = 50;
          b = 40;
        }

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(x, segY, barWidth, segmentHeight);
      }

      // Peak hold
      if (normalized > (peaksRef.current[i] || 0)) {
        peaksRef.current[i] = normalized;
      } else {
        peaksRef.current[i] = Math.max(0, (peaksRef.current[i] || 0) - 0.01);
      }

      const peakSegment = Math.floor(peaksRef.current[i] * totalSegments);
      if (peakSegment > 0) {
        const peakY = height - peakSegment * (segmentHeight + segmentGap);
        const peakRatio = peakSegment / totalSegments;
        if (peakRatio < 0.6) {
          ctx.fillStyle = "rgb(80, 255, 80)";
        } else if (peakRatio < 0.8) {
          ctx.fillStyle = "rgb(255, 255, 80)";
        } else {
          ctx.fillStyle = "rgb(255, 80, 80)";
        }
        ctx.fillRect(x, peakY, barWidth, segmentHeight);
      }
    }

    if (isPlaying) {
      animRef.current = requestAnimationFrame(draw);
    }
  }, [isPlaying, nodes]);

  useEffect(() => {
    draw();
    if (isPlaying) {
      animRef.current = requestAnimationFrame(draw);
    }
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [draw, isPlaying]);

  // Draw idle state when not playing
  useEffect(() => {
    if (!isPlaying) {
      peaksRef.current = new Array(BAR_COUNT).fill(0);
      draw();
    }
  }, [isPlaying, draw]);

  if (!sourceBuffer) return null;

  return (
    <div className="relative bg-gradient-to-b from-[#3a3a3e] to-[#2a2a2e] border border-[#1a1a1a] shadow-[0_4px_16px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)] p-4">
      <div className="bg-[#0a0a0a] border border-[#111] shadow-[inset_0_2px_8px_rgba(0,0,0,0.8)] p-1">
        <canvas ref={canvasRef} className="w-full h-36 block" />
      </div>
    </div>
  );
}
