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

    // Dark tinted glass background
    ctx.fillStyle = "#080808";
    ctx.fillRect(0, 0, width, height);

    // Subtle warm grid lines
    ctx.strokeStyle = "rgba(212, 175, 55, 0.03)";
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

        // VU meter color scheme: green → yellow → orange → red
        let r, g, b;
        if (ratio < 0.4) {
          // Green zone
          r = 30 + ratio * 120;
          g = 140 + ratio * 200;
          b = 30;
        } else if (ratio < 0.65) {
          // Yellow zone
          const t = (ratio - 0.4) / 0.25;
          r = 80 + t * 175;
          g = 220 - t * 30;
          b = 30;
        } else if (ratio < 0.85) {
          // Orange zone
          const t = (ratio - 0.65) / 0.2;
          r = 255;
          g = 190 - t * 100;
          b = 20;
        } else {
          // Red zone
          r = 255;
          g = 90 - (ratio - 0.85) * 300;
          b = 20;
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
        ctx.fillStyle = "rgb(255, 60, 40)";
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

  useEffect(() => {
    if (!isPlaying) {
      peaksRef.current = new Array(BAR_COUNT).fill(0);
      draw();
    }
  }, [isPlaying, draw]);

  return (
    <div className="wood-grain p-[6px]">
      <div className="dark-faceplate border border-[#444] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="p-3">
          <div className="tinted-glass border border-[#222] p-1">
            <canvas ref={canvasRef} className="w-full h-36 block" />
          </div>
        </div>
      </div>
    </div>
  );
}
