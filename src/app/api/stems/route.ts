import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { PinataSDK } from "pinata";

export const maxDuration = 300;

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

export async function POST(req: NextRequest) {
  const modalUrl    = process.env.MODAL_STEMS_URL;
  const pinataJwt   = process.env.PINATA_JWT;
  const pinataGw    = process.env.PINATA_GATEWAY;

  if (!modalUrl)  return NextResponse.json({ error: "MODAL_STEMS_URL not configured" },  { status: 500 });
  if (!pinataJwt) return NextResponse.json({ error: "PINATA_JWT not configured" },        { status: 500 });
  if (!pinataGw)  return NextResponse.json({ error: "PINATA_GATEWAY not configured" },    { status: 500 });

  try {
    let audioUrl: string;
    let xRun: string | null = null;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      // YouTube — get CDN URL from RapidAPI, pass to Modal
      const body = await req.json();
      if (!body.youtubeUrl) return NextResponse.json({ error: "No youtubeUrl provided" }, { status: 400 });

      const videoId = extractVideoId(body.youtubeUrl);
      if (!videoId) return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });

      const apiRes = await fetch(`https://youtube-mp36.p.rapidapi.com/dl?id=${videoId}`, {
        headers: {
          "X-RapidAPI-Key":  process.env.RAPIDAPI_KEY!,
          "X-RapidAPI-Host": "youtube-mp36.p.rapidapi.com",
        },
      });
      if (!apiRes.ok) return NextResponse.json({ error: `RapidAPI HTTP ${apiRes.status}` }, { status: 502 });

      const data = await apiRes.json();
      if (data.status !== "ok" || !data.link) {
        return NextResponse.json({ error: data.msg || "No download link" }, { status: 502 });
      }
      audioUrl = data.link;
      xRun = createHash("md5").update(process.env.RAPIDAPI_USERNAME!).digest("hex");
    } else {
      // Local file — upload to Pinata first so Modal can fetch it
      const formData = await req.formData();
      const file = formData.get("audio") as File | null;
      if (!file) return NextResponse.json({ error: "No audio file" }, { status: 400 });

      const pinata = new PinataSDK({ pinataJwt, pinataGateway: pinataGw });
      const upload = await pinata.upload.public.file(file).name(`stems-input-${Date.now()}`);
      audioUrl = `${pinataGw}/ipfs/${upload.cid}`;
    }

    const modalBody: Record<string, unknown> = {
      audio_url:      audioUrl,
      pinata_jwt:     pinataJwt,
      pinata_gateway: pinataGw,
    };
    if (xRun) modalBody.x_run = xRun;

    console.log("[stems] calling Modal...");
    const res = await fetch(modalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(modalBody),
    });

    const result = await res.json();
    if (!res.ok || result.error) {
      return NextResponse.json({ error: result.error || "Modal stems error" }, { status: 502 });
    }

    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Stem separation failed";
    console.error("[stems] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
