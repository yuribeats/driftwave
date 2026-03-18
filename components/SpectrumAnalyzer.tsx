"use client";

import { useRef, useEffect, useCallback } from "react";
import { useStore } from "../lib/store";

const BAR_COUNT = 32;
const BAR_GAP = 2;

export default function SpectrumAnalyzer() {
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

    // CRT green background
    ctx.fillStyle = "#1e2e1a";
    ctx.fillRect(0, 0, width, height);

    // CRT grid lines
    ctx.strokeStyle = "rgba(44, 66, 37, 0.5)";
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
      const binIndex = Math.floor(Math.pow(i / BAR_COUNT, 1.5) * freqData.length);
      const value = freqData[binIndex] || 0;
      const normalized = value / 255;
      const x = i * (barWidth + BAR_GAP);

      const segmentHeight = 4;
      const segmentGap = 1;
      const totalSegments = Math.floor(height / (segmentHeight + segmentGap));
      const activeSegments = Math.floor(normalized * totalSegments);

      for (let s = 0; s < activeSegments; s++) {
        const segY = height - (s + 1) * (segmentHeight + segmentGap);
        const ratio = s / totalSegments;

        // CRT green color scheme
        let r, g, b;
        if (ratio < 0.5) {
          r = 40;
          g = 100 + ratio * 160;
          b = 20;
        } else if (ratio < 0.8) {
          r = 60;
          g = 180;
          b = 40;
        } else {
          r = 80 + ratio * 100;
          g = 204;
          b = 50 + ratio * 50;
        }

        ctx.fillStyle = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
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
        ctx.fillStyle = "#75cc46";
        ctx.shadowColor = "#75cc46";
        ctx.shadowBlur = 6;
        ctx.fillRect(x, peakY, barWidth, segmentHeight);
        ctx.shadowBlur = 0;
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

  useEffect(() => {
    if (!isPlaying) {
      peaksRef.current = new Array(BAR_COUNT).fill(0);
      draw();
    }
  }, [isPlaying, draw]);

  return (
    <div className="crt" style={{ height: "180px" }}>
      <div className="absolute top-0 left-0 right-0 px-2 py-1 flex justify-between text-[10px] z-10" style={{ color: "var(--crt-bright)", borderBottom: "1px solid var(--crt-grid)" }}>
        <span>OUTPUT LEVEL</span>
      </div>
      <div className="crt-grid w-full h-full pt-6 px-2 pb-2">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
    </div>
  );
}
