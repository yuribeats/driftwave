"use client";

import { useRef, useEffect, useCallback } from "react";
import { useStore } from "../lib/store";
import { getAudioContext } from "../lib/audio-context";

export default function WaveformCanvas() {
  const sourceBuffer = useStore((s) => s.sourceBuffer);
  const processedBuffer = useStore((s) => s.processedBuffer);
  const isPlaying = useStore((s) => s.isPlaying);
  const startedAt = useStore((s) => s.startedAt);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  const drawWaveform = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      buffer: AudioBuffer,
      color: string,
      width: number,
      height: number
    ) => {
      const data = buffer.getChannelData(0);
      const step = Math.ceil(data.length / width);
      const mid = height / 2;

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();

      for (let i = 0; i < width; i++) {
        const start = i * step;
        let min = 1.0;
        let max = -1.0;
        for (let j = 0; j < step && start + j < data.length; j++) {
          const val = data[start + j];
          if (val < min) min = val;
          if (val > max) max = val;
        }
        ctx.moveTo(i, mid + min * mid);
        ctx.lineTo(i, mid + max * mid);
      }
      ctx.stroke();
    },
    []
  );

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

    ctx.clearRect(0, 0, width, height);

    // Draw source waveform
    if (sourceBuffer) {
      drawWaveform(ctx, sourceBuffer, "#7a6440", width, height);
    }

    // Draw processed waveform
    if (processedBuffer) {
      drawWaveform(ctx, processedBuffer, "#c8a96e", width, height);
    }

    // Draw playhead
    if (isPlaying && processedBuffer) {
      const audioCtx = getAudioContext();
      const elapsed = audioCtx.currentTime - startedAt;
      const progress = elapsed / processedBuffer.duration;
      if (progress >= 0 && progress <= 1) {
        const x = progress * width;
        ctx.strokeStyle = "#e8e0d0";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      animRef.current = requestAnimationFrame(draw);
    }
  }, [sourceBuffer, processedBuffer, isPlaying, startedAt, drawWaveform]);

  useEffect(() => {
    draw();
    if (isPlaying) {
      animRef.current = requestAnimationFrame(draw);
    }
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [draw, isPlaying]);

  if (!sourceBuffer) return null;

  return (
    <div className="border border-dw-border p-4">
      <canvas ref={canvasRef} className="w-full h-32 block" />
    </div>
  );
}
