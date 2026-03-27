import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const maxDuration = 300;

async function uploadToReplicate(fileBytes: ArrayBuffer, filename: string): Promise<string> {
  const fd = new FormData();
  fd.append("content", new Blob([fileBytes]), filename);
  const res = await fetch("https://api.replicate.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` },
    body: fd,
  });
  if (!res.ok) throw new Error(`Replicate upload failed (${res.status})`);
  const data = await res.json();
  const url = data.urls?.get;
  if (!url) throw new Error("No URL from Replicate upload");
  return url;
}

export async function POST(req: NextRequest) {
  const modalUrl = process.env.MODAL_DOWNBEAT_URL;
  if (!modalUrl) {
    return NextResponse.json({ error: "MODAL_DOWNBEAT_URL not configured" }, { status: 500 });
  }

  try {
    let audioUrl: string;
    const priors: Record<string, unknown> = {};
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = await req.json();
      if (body.bpm)        priors.bpm        = body.bpm;
      if (body.note_index !== undefined) priors.note_index = body.note_index;
      if (body.mode)       priors.mode       = body.mode;

      if (body.audioUrl) {
        audioUrl = body.audioUrl;
      } else {
        return NextResponse.json({ error: "Missing audioUrl" }, { status: 400 });
      }
    } else {
      // File upload — priors come as form fields
      const formData = await req.formData();
      const file = formData.get("audio") as File | null;
      if (!file) return NextResponse.json({ error: "No audio file" }, { status: 400 });
      const bpmField = formData.get("bpm");
      const niField  = formData.get("note_index");
      if (bpmField)  priors.bpm        = parseFloat(String(bpmField));
      if (niField)   priors.note_index = parseInt(String(niField), 10);
      audioUrl = await uploadToReplicate(await file.arrayBuffer(), file.name || "audio.mp3");
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const tokenId = process.env.MODAL_TOKEN_ID;
    const tokenSecret = process.env.MODAL_TOKEN_SECRET;
    if (tokenId && tokenSecret) {
      headers["Authorization"] = `Token ${tokenId}:${tokenSecret}`;
    }

    const res = await fetch(modalUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ audio_url: audioUrl, ...priors }),
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
