import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const COBALT_INSTANCES = [
  "https://api.cobalt.tools",
  "https://cobalt.canine.tools",
  "https://cobalt-api.ayo.tf",
];

const TIMEOUT = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Strategy: RapidAPI → Cobalt
export async function POST(req: NextRequest) {
  const { url } = await req.json();

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // 1. RapidAPI — returns JSON with redirect URL (browser downloads directly)
  if (process.env.RAPIDAPI_KEY) {
    try {
      const result = await withTimeout(tryRapidApi(url), TIMEOUT, "RapidAPI");
      if (result) return result;
    } catch { /* next */ }
  }

  // 2. Cobalt — returns audio buffer directly
  for (const instance of COBALT_INSTANCES) {
    try {
      const result = await withTimeout(tryCobalt(instance, url), TIMEOUT, instance);
      if (result) return result;
    } catch { continue; }
  }

  return NextResponse.json(
    { error: "Could not extract audio. All methods failed." },
    { status: 502 }
  );
}

async function tryRapidApi(url: string): Promise<NextResponse | null> {
  const videoId = extractVideoId(url);
  if (!videoId) return null;

  const res = await fetch(`https://youtube-mp36.p.rapidapi.com/dl?id=${videoId}`, {
    headers: {
      "X-RapidAPI-Key": process.env.RAPIDAPI_KEY!,
      "X-RapidAPI-Host": "youtube-mp36.p.rapidapi.com",
    },
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== "ok" || !data.link) return null;

  const title = (data.title || "youtube-audio").replace(/[^\w\s-]/g, "").trim().substring(0, 80);

  // Return JSON with redirect URL — frontend fetches audio from this URL directly
  return NextResponse.json({ redirectUrl: data.link, title }, {
    headers: { "X-Audio-Title": title },
  });
}

async function tryCobalt(instance: string, url: string): Promise<NextResponse | null> {
  const response = await fetch(instance, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ url, downloadMode: "audio", audioFormat: "mp3", audioBitrate: "320" }),
  });

  const data = await response.json();
  if (!response.ok || data.status === "error" || !data.url) return null;

  const audioRes = await fetch(data.url);
  if (!audioRes.ok) return null;

  return new NextResponse(await audioRes.arrayBuffer(), {
    headers: {
      "Content-Type": audioRes.headers.get("Content-Type") ?? "audio/mpeg",
      "Content-Disposition": `attachment; filename="audio.mp3"`,
      "X-Audio-Title": data.filename ?? "youtube-audio",
    },
  });
}
