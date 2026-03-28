import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
const DEMUCS_VERSION = "5a7041cc9b82e5a558fea6b3d7b12dea89625e89da33f0447bd727c2d0ab9e77";

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function downloadYouTubeMP3(youtubeUrl: string): Promise<ArrayBuffer> {
  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) throw new Error("Invalid YouTube URL");

  const apiRes = await fetch(`https://youtube-mp36.p.rapidapi.com/dl?id=${videoId}`, {
    headers: {
      "X-RapidAPI-Key": process.env.RAPIDAPI_KEY!,
      "X-RapidAPI-Host": "youtube-mp36.p.rapidapi.com",
    },
  });

  if (!apiRes.ok) throw new Error(`RapidAPI HTTP ${apiRes.status}`);
  const data = await apiRes.json();
  if (data.status !== "ok" || !data.link) throw new Error(data.msg || "No download link");

  const xrun = createHash("md5").update(process.env.RAPIDAPI_USERNAME!).digest("hex");
  const audioRes = await fetch(data.link, { headers: { "X-RUN": xrun } });
  if (!audioRes.ok) throw new Error(`Audio download HTTP ${audioRes.status}`);

  const buf = await audioRes.arrayBuffer();
  if (buf.byteLength < 10_000) throw new Error("Download too small — not valid audio");
  return buf;
}

async function uploadToReplicate(fileBytes: ArrayBuffer, filename: string): Promise<string> {
  const fd = new FormData();
  fd.append("content", new Blob([fileBytes]), filename);

  const res = await fetch("https://api.replicate.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` },
    body: fd,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Replicate upload failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const fileUrl = data.urls?.get;
  if (!fileUrl) throw new Error("No URL from Replicate upload");
  return fileUrl;
}

export async function POST(req: NextRequest) {
  if (!REPLICATE_TOKEN) {
    return NextResponse.json({ error: "REPLICATE_API_TOKEN not configured" }, { status: 500 });
  }

  try {
    let fileUrl: string;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = await req.json();
      if (!body.youtubeUrl) {
        return NextResponse.json({ error: "No youtubeUrl provided" }, { status: 400 });
      }
      console.log("[stems] Downloading YouTube audio server-side...");
      const mp3 = await downloadYouTubeMP3(body.youtubeUrl);
      console.log("[stems] Downloaded MP3:", mp3.byteLength, "bytes");
      fileUrl = await uploadToReplicate(mp3, "audio.mp3");
      console.log("[stems] Uploaded to Replicate:", fileUrl);
    } else {
      const formData = await req.formData();
      const file = formData.get("audio") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No audio file" }, { status: 400 });
      }
      console.log("[stems] File received:", file.name, "size:", file.size);
      fileUrl = await uploadToReplicate(await file.arrayBuffer(), file.name || "audio.mp3");
    }

    const predRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: DEMUCS_VERSION,
        input: { audio: fileUrl, model: "htdemucs_ft" },
      }),
    });

    if (!predRes.ok) {
      const text = await predRes.text();
      return NextResponse.json({ error: `Prediction failed: ${text}` }, { status: 502 });
    }

    let prediction = await predRes.json();
    const pollUrl = prediction.urls?.get;
    if (!pollUrl) {
      return NextResponse.json({ error: "No poll URL" }, { status: 502 });
    }

    const deadline = Date.now() + 280_000;
    while (prediction.status !== "succeeded" && prediction.status !== "failed") {
      if (Date.now() > deadline) {
        return NextResponse.json({ error: "Timed out" }, { status: 504 });
      }
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` },
      });
      prediction = await pollRes.json();
    }

    if (prediction.status === "failed") {
      return NextResponse.json({ error: prediction.error || "Demucs failed" }, { status: 502 });
    }

    const output = prediction.output;
    if (!output) {
      return NextResponse.json({ error: "No output" }, { status: 502 });
    }

    return NextResponse.json({
      vocals: output.vocals || null,
      drums: output.drums || null,
      bass: output.bass || null,
      other: output.other || null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Stem separation failed";
    console.error("[stems] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
