"use client";

import { useRef, useEffect, useCallback } from "react";

const BAR_COUNT = 24;
const BAR_GAP = 2;

interface Props {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
}

export default function MiniSpectrum({ analyser, isPlaying }: Props) {
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

    ctx.fillStyle = "#1e2e1a";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(44, 66, 37, 0.5)";
    ctx.lineWidth = 1;
    for (let y = 0; y < height; y += 10) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const barWidth = (width - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT;
    const freqData = new Uint8Array(128);

    if (analyser && isPlaying) {
      analyser.getByteFrequencyData(freqData);
    }

    for (let i = 0; i < BAR_COUNT; i++) {
      const binIndex = Math.floor(Math.pow(i / BAR_COUNT, 1.5) * freqData.length);
      const value = freqData[binIndex] || 0;
      const normalized = value / 255;
      const x = i * (barWidth + BAR_GAP);

      const segmentHeight = 3;
      const segmentGap = 1;
      const totalSegments = Math.floor(height / (segmentHeight + segmentGap));
      const activeSegments = Math.floor(normalized * totalSegments);

      for (let s = 0; s < activeSegments; s++) {
        const segY = height - (s + 1) * (segmentHeight + segmentGap);
        const ratio = s / totalSegments;
        const r = ratio < 0.5 ? 40 : ratio < 0.8 ? 60 : 80 + ratio * 100;
        const g = ratio < 0.5 ? 100 + ratio * 160 : ratio < 0.8 ? 180 : 204;
        const b = ratio < 0.5 ? 20 : ratio < 0.8 ? 40 : 50 + ratio * 50;

        ctx.fillStyle = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
        ctx.fillRect(x, segY, barWidth, segmentHeight);
      }

      if (normalized > (peaksRef.current[i] || 0)) {
        peaksRef.current[i] = normalized;
      } else {
        peaksRef.current[i] = Math.max(0, (peaksRef.current[i] || 0) - 0.015);
      }

      const peakSegment = Math.floor(peaksRef.current[i] * totalSegments);
      if (peakSegment > 0) {
        const peakY = height - peakSegment * (segmentHeight + segmentGap);
        ctx.fillStyle = "#75cc46";
        ctx.shadowColor = "#75cc46";
        ctx.shadowBlur = 4;
        ctx.fillRect(x, peakY, barWidth, segmentHeight);
        ctx.shadowBlur = 0;
      }
    }

    if (isPlaying) {
      animRef.current = requestAnimationFrame(draw);
    }
  }, [isPlaying, analyser]);

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
    <div className="crt" style={{ height: "100px" }}>
      <div className="crt-grid w-full h-full p-1">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
    </div>
  );
}
