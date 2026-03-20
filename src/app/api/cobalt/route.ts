import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const COBALT_INSTANCES = [
  "https://api.cobalt.tools",
  "https://cobalt.canine.tools",
  "https://cobalt-api.ayo.tf",
];

const TIMEOUT = 15_000;
const MIN_AUDIO_SIZE = 10_000;

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
// All paths download audio server-side and return the buffer directly.
// Never return third-party URLs to the browser — they block datacenter IPs and browsers.
export async function POST(req: NextRequest) {
  const { url } = await req.json();

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  const errors: string[] = [];

  // 1. RapidAPI (paid, reliable)
  if (process.env.RAPIDAPI_KEY) {
    try {
      const result = await withTimeout(tryRapidApi(url), TIMEOUT, "RapidAPI");
      if (result) return result;
      else errors.push("RapidAPI: no result");
    } catch (e) {
      errors.push(`RapidAPI: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    errors.push("RapidAPI: RAPIDAPI_KEY not set");
  }

  // 2. Cobalt (free fallback)
  for (const instance of COBALT_INSTANCES) {
    try {
      const result = await withTimeout(tryCobalt(instance, url), TIMEOUT, instance);
      if (result) return result;
      else errors.push(`${instance}: no result`);
    } catch (e) {
      errors.push(`${instance}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
  }

  console.error("All extraction methods failed:", errors);
  return NextResponse.json(
    { error: `Could not extract audio. ${errors.join(" | ")}` },
    { status: 502 }
  );
}

async function tryRapidApi(url: string): Promise<NextResponse | null> {
  const videoId = extractVideoId(url);
  if (!videoId) return null;

  const apiRes = await fetch(`https://youtube-mp36.p.rapidapi.com/dl?id=${videoId}`, {
    headers: {
      "X-RapidAPI-Key": process.env.RAPIDAPI_KEY!,
      "X-RapidAPI-Host": "youtube-mp36.p.rapidapi.com",
    },
  });

  if (!apiRes.ok) {
    console.error("RapidAPI HTTP", apiRes.status);
    return null;
  }

  const data = await apiRes.json();
  console.log("RapidAPI response:", JSON.stringify({ status: data.status, hasLink: !!data.link, title: data.title }));
  if (data.status !== "ok" || !data.link) return null;

  // Download audio server-side with browser User-Agent
  const audioRes = await fetch(data.link, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  });

  if (!audioRes.ok) {
    console.error("RapidAPI download failed:", audioRes.status);
    return null;
  }

  const buffer = await audioRes.arrayBuffer();
  console.log("RapidAPI download size:", buffer.byteLength);

  if (buffer.byteLength < MIN_AUDIO_SIZE) {
    console.error("RapidAPI download too small:", buffer.byteLength, "bytes");
    return null;
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

async function tryCobalt(instance: string, url: string): Promise<NextResponse | null> {
  const response = await fetch(instance, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ url, downloadMode: "audio", audioFormat: "mp3", audioBitrate: "320" }),
  });

  if (!response.ok) return null;
  const data = await response.json();
  if (data.status === "error" || !data.url) return null;

  const audioRes = await fetch(data.url);
  if (!audioRes.ok) return null;

  const buffer = await audioRes.arrayBuffer();

  if (buffer.byteLength < MIN_AUDIO_SIZE) {
    console.error(`Cobalt ${instance} download too small:`, buffer.byteLength, "bytes");
    return null;
  }

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": audioRes.headers.get("Content-Type") ?? "audio/mpeg",
      "Content-Disposition": `attachment; filename="audio.mp3"`,
      "X-Audio-Title": data.filename ?? "youtube-audio",
    },
  });
}
