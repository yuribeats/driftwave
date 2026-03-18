import { NextRequest, NextResponse } from "next/server";
import ytdl from "@distube/ytdl-core";

export const maxDuration = 60;

const COBALT_INSTANCES = [
  "https://api.cobalt.tools",
  "https://cobalt.canine.tools",
  "https://cobalt-api.ayo.tf",
];

// Try ytdl-core first, fall back to cobalt instances
export async function POST(req: NextRequest) {
  const { url } = await req.json();

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Try ytdl-core
  if (ytdl.validateURL(url)) {
    try {
      const result = await tryYtdl(url);
      if (result) return result;
    } catch {
      // Fall through to cobalt
    }
  }

  // Try cobalt instances
  for (const instance of COBALT_INSTANCES) {
    try {
      const result = await tryCobalt(instance, url);
      if (result) return result;
    } catch {
      continue;
    }
  }

  return NextResponse.json(
    { error: "Could not extract audio. YouTube may be blocking automated requests." },
    { status: 502 }
  );
}

async function tryYtdl(url: string): Promise<NextResponse | null> {
  const info = await ytdl.getInfo(url, {
    requestOptions: {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    },
  });

  const title =
    info.videoDetails.title
      .replace(/[^\w\s-]/g, "")
      .trim()
      .substring(0, 80) || "youtube-audio";

  const format = ytdl.chooseFormat(info.formats, {
    quality: "highestaudio",
    filter: "audioonly",
  });

  const response = await fetch(format.url);
  if (!response.ok) return null;

  const buffer = await response.arrayBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": format.mimeType?.split(";")[0] ?? "audio/webm",
      "Content-Disposition": `attachment; filename="audio"`,
      "X-Audio-Title": title,
    },
  });
}

async function tryCobalt(
  instance: string,
  url: string
): Promise<NextResponse | null> {
  const response = await fetch(instance, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      url,
      downloadMode: "audio",
      audioFormat: "mp3",
      audioBitrate: "320",
    }),
  });

  const data = await response.json();

  if (!response.ok || data.status === "error") return null;

  if (data.url) {
    const audioResponse = await fetch(data.url);
    if (!audioResponse.ok) return null;

    const audioBuffer = await audioResponse.arrayBuffer();

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type":
          audioResponse.headers.get("Content-Type") ?? "audio/mpeg",
        "Content-Disposition": `attachment; filename="audio.mp3"`,
        "X-Audio-Title": data.filename ?? "youtube-audio",
      },
    });
  }

  return null;
}
