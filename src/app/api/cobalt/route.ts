import { NextRequest, NextResponse } from "next/server";

const COBALT_INSTANCES = [
  "https://cookie.br0k3.me",
  "https://pizza.br0k3.me",
  "https://api.cobalt.blackcat.sweeux.org",
];

export async function POST(req: NextRequest) {
  const { url } = await req.json();

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  for (const instance of COBALT_INSTANCES) {
    try {
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

      if (!response.ok || data.status === "error") {
        continue;
      }

      if (data.url) {
        const audioResponse = await fetch(data.url);
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
    } catch {
      continue;
    }
  }

  return NextResponse.json(
    { error: "All Cobalt instances failed" },
    { status: 502 }
  );
}
