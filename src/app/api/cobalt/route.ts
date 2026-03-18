import { NextRequest, NextResponse } from "next/server";
import ytdl from "@distube/ytdl-core";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { url } = await req.json();

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (!ytdl.validateURL(url)) {
    return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
  }

  try {
    const info = await ytdl.getInfo(url);
    const title =
      info.videoDetails.title
        .replace(/[^\w\s-]/g, "")
        .trim()
        .substring(0, 80) || "youtube-audio";

    // Get best audio-only format
    const format = ytdl.chooseFormat(info.formats, {
      quality: "highestaudio",
      filter: "audioonly",
    });

    const response = await fetch(format.url);
    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": format.mimeType?.split(";")[0] ?? "audio/webm",
        "Content-Disposition": `attachment; filename="audio"`,
        "X-Audio-Title": title,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to extract audio";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
