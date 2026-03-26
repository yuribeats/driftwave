import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

export async function POST(req: NextRequest) {
  const { url } = await req.json();

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (!process.env.RAPIDAPI_KEY || !process.env.RAPIDAPI_USERNAME) {
    return NextResponse.json({ error: "RapidAPI not configured" }, { status: 500 });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return NextResponse.json({ error: "Could not extract YouTube video ID" }, { status: 400 });
  }

  // Step 1: Get download link from RapidAPI
  const apiRes = await fetch(`https://youtube-mp36.p.rapidapi.com/dl?id=${videoId}`, {
    headers: {
      "X-RapidAPI-Key": process.env.RAPIDAPI_KEY,
      "X-RapidAPI-Host": "youtube-mp36.p.rapidapi.com",
    },
  });

  if (!apiRes.ok) {
    console.error("RapidAPI HTTP", apiRes.status);
    return NextResponse.json({ error: `RapidAPI error: HTTP ${apiRes.status}` }, { status: 502 });
  }

  const data = await apiRes.json();
  console.log("RapidAPI response:", JSON.stringify(data));

  if (data.status !== "ok" || !data.link) {
    return NextResponse.json(
      { error: `RapidAPI: ${data.msg || data.status || "no download link"}` },
      { status: 502 }
    );
  }

  // Step 2: Download audio with X-RUN whitelist header
  const xrun = createHash("md5").update(process.env.RAPIDAPI_USERNAME).digest("hex");

  const audioRes = await fetch(data.link, {
    headers: { "X-RUN": xrun },
  });

  if (!audioRes.ok) {
    console.error("Audio download failed:", audioRes.status);
    return NextResponse.json(
      { error: `Audio download failed: HTTP ${audioRes.status}` },
      { status: 502 }
    );
  }

  const buffer = await audioRes.arrayBuffer();
  console.log("Audio download size:", buffer.byteLength, "bytes");

  if (buffer.byteLength < 10_000) {
    return NextResponse.json(
      { error: `Download returned ${buffer.byteLength} bytes — not valid audio` },
      { status: 502 }
    );
  }

  const title = (data.title || "youtube-audio").replace(/[^\w\s-]/g, "").trim().substring(0, 80);

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Disposition": `attachment; filename="audio.mp3"`,
      "X-Audio-Title": title,
    },
  });
}
