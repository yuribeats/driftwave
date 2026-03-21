"use client";

import { useState } from "react";
import { generateCover } from "../lib/cover-generator";
import { useStore } from "../lib/store";
import { expandParams, renderOffline, encodeWAV } from "@yuribeats/audio-utils";
import { getAudioContext } from "../lib/audio-context";

function normalizeBuffer(buf: AudioBuffer): AudioBuffer {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }
  if (peak > 0 && peak !== 1) {
    const gain = 1 / peak;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        data[i] *= gain;
      }
    }
  }
  return buf;
}

export default function ExportVideoModal({ onClose }: { onClose: () => void }) {
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [exporting, setExporting] = useState(false);

  const sourceBuffer = useStore((s) => s.sourceBuffer);
  const sourceFilename = useStore((s) => s.sourceFilename);
  const params = useStore((s) => s.params);

  const handleExport = async () => {
    if (!artist.trim() || !title.trim() || !sourceBuffer) return;

    setExporting(true);

    try {
      // Step 1: Generate cover image
      setStatus("GENERATING COVER...");
      const coverBlob = await generateCover(artist.trim(), title.trim());

      // Step 2: Render processed audio
      setStatus("RENDERING AUDIO...");
      const expanded = expandParams(params);
      const channelData: Float32Array[] = [];
      for (let c = 0; c < sourceBuffer.numberOfChannels; c++) {
        channelData.push(sourceBuffer.getChannelData(c));
      }

      const result = await renderOffline({
        channelData,
        sampleRate: sourceBuffer.sampleRate,
        numberOfChannels: sourceBuffer.numberOfChannels,
        length: sourceBuffer.length,
        params: expanded,
      });

      const ctx = getAudioContext();
      const buf = ctx.createBuffer(
        result.numberOfChannels,
        result.length,
        result.sampleRate
      );
      for (let c = 0; c < result.numberOfChannels; c++) {
        buf.getChannelData(c).set(result.channelData[c]);
      }

      const normalized = normalizeBuffer(buf);
      const audioBlob = encodeWAV(normalized);

      // Step 3: Upload audio to Pinata
      setStatus("UPLOADING AUDIO...");
      const urlRes = await fetch("/api/pinata-upload-url", { method: "POST" });
      if (!urlRes.ok) throw new Error("FAILED TO GET UPLOAD URL");
      const { url: uploadUrl } = await urlRes.json();
      const uploadForm = new FormData();
      uploadForm.append("file", audioBlob, "audio.wav");
      const uploadRes = await fetch(uploadUrl, { method: "POST", body: uploadForm });
      if (!uploadRes.ok) throw new Error("AUDIO UPLOAD FAILED");
      const uploadData = await uploadRes.json();
      const audioCid = uploadData.data?.cid || uploadData.cid;

      // Step 4: Send CID + cover to generate-video API
      setStatus("GENERATING VIDEO...");
      const formData = new FormData();
      formData.append("audioCid", audioCid);
      formData.append("image", coverBlob, "cover.png");
      formData.append("artist", artist.trim());
      formData.append("title", title.trim());

      const res = await fetch("/api/generate-video", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "VIDEO GENERATION FAILED");
      }

      // Step 4: Download via Pinata URL
      setStatus("DOWNLOADING...");
      const a = document.createElement("a");
      a.href = data.url;
      a.download = sourceFilename
        ? `${sourceFilename}-driftwave.mp4`
        : "driftwave-export.mp4";
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setStatus("DONE");
      setTimeout(() => onClose(), 2000);
    } catch (e) {
      console.error(e);
      setStatus("ERROR: " + (e instanceof Error ? e.message : "FAILED"));
      setTimeout(() => setStatus(""), 5000);
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={(e) => { if (e.target === e.currentTarget && !exporting) onClose(); }}
    >
      <div className="console w-full max-w-[440px] mx-4 p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span
            className="text-sm tracking-[2px] uppercase"
            style={{ color: "var(--text-dark)", fontFamily: "var(--font-display)" }}
          >
            EXPORT MP4
          </span>
          {!exporting && (
            <button
              onClick={onClose}
              className="text-[10px] uppercase tracking-wider border border-[#333] px-2 py-1"
              style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", background: "transparent" }}
            >
              CLOSE
            </button>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider" style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)" }}>
            ARTIST
          </span>
          <input
            type="text"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            disabled={exporting}
            placeholder="ARTIST NAME"
            className="bg-transparent border border-[#333] px-3 py-2 text-[13px] uppercase tracking-wider"
            style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", outline: "none" }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider" style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)" }}>
            TITLE
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={exporting}
            placeholder="TRACK TITLE"
            className="bg-transparent border border-[#333] px-3 py-2 text-[13px] uppercase tracking-wider"
            style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)", outline: "none" }}
          />
        </div>

        <button
          onClick={handleExport}
          disabled={exporting || !artist.trim() || !title.trim() || !sourceBuffer}
          className="border-2 border-[var(--accent-gold)] px-4 py-3 text-[12px] uppercase tracking-wider disabled:opacity-30"
          style={{ fontFamily: "var(--font-tech)", color: "var(--accent-gold)", background: "transparent" }}
        >
          {exporting ? status : "EXPORT MP4"}
        </button>

        <div className="text-[9px] uppercase tracking-wider" style={{ fontFamily: "var(--font-tech)", color: "var(--text-dark)" }}>
          GENERATES A VIDEO WITH YOUR PROCESSED AUDIO + RANDOM COVER ART
        </div>
      </div>
    </div>
  );
}
