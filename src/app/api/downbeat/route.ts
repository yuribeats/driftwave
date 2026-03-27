import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

export async function POST(req: NextRequest) {
  const modalUrl = process.env.MODAL_DOWNBEAT_URL;
  if (!modalUrl) {
    return NextResponse.json({ error: "MODAL_DOWNBEAT_URL not configured" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { youtubeUrl, audioUrl, ...priors } = body;

    let finalAudioUrl: string;
    let xRun: string | null = null;

    if (youtubeUrl) {
      const videoId = extractVideoId(youtubeUrl);
      if (!videoId) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

      const apiRes = await fetch(`https://youtube-mp36.p.rapidapi.com/dl?id=${videoId}`, {
        headers: {
          "X-RapidAPI-Key": process.env.RAPIDAPI_KEY!,
          "X-RapidAPI-Host": "youtube-mp36.p.rapidapi.com",
        },
      });
      if (!apiRes.ok) return NextResponse.json({ error: `RapidAPI HTTP ${apiRes.status}` }, { status: 502 });
      const data = await apiRes.json();
      if (data.status !== "ok" || !data.link) {
        return NextResponse.json({ error: `RapidAPI: ${data.msg || data.status || "no link"}` }, { status: 502 });
      }
      finalAudioUrl = data.link;
      xRun = createHash("md5").update(process.env.RAPIDAPI_USERNAME!).digest("hex");
    } else if (audioUrl) {
      finalAudioUrl = audioUrl;
    } else {
      return NextResponse.json({ error: "Missing youtubeUrl or audioUrl" }, { status: 400 });
    }

    const modalBody: Record<string, unknown> = { audio_url: finalAudioUrl, ...priors };
    if (xRun) modalBody.x_run = xRun;

    const res = await fetch(modalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(modalBody),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      return NextResponse.json({ error: data.error || "Modal downbeat error" }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Downbeat detection failed";
    console.error("[downbeat] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
