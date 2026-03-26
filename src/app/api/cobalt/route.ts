import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { url } = await req.json();

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // Step 1: Get download link from cobalt.tools
  const cobaltRes = await fetch("https://api.cobalt.tools/", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      downloadMode: "audio",
      audioFormat: "mp3",
    }),
  });

  if (!cobaltRes.ok) {
    console.error("cobalt.tools HTTP", cobaltRes.status);
    return NextResponse.json({ error: `cobalt error: HTTP ${cobaltRes.status}` }, { status: 502 });
  }

  const data = await cobaltRes.json();
  console.log("cobalt.tools response:", JSON.stringify(data));

  if (data.status === "error" || !data.url) {
    return NextResponse.json(
      { error: `cobalt: ${data.error?.code || data.status || "no download link"}` },
      { status: 502 }
    );
  }

  // Step 2: Download audio
  const audioRes = await fetch(data.url);

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

  const filename = (data.filename || "audio.mp3").replace(/[^\w.\s-]/g, "").trim();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Disposition": `attachment; filename="audio.mp3"`,
      "X-Audio-Title": filename,
    },
  });
}
