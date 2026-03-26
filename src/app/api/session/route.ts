import { NextRequest, NextResponse } from "next/server";
import { PinataSDK } from "pinata";

export const maxDuration = 120;

function getPinata() {
  return new PinataSDK({
    pinataJwt: process.env.PINATA_JWT!,
    pinataGateway: process.env.PINATA_GATEWAY!,
  });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const sessionStr = formData.get("session") as string | null;
    const audioA = formData.get("audioA") as File | null;
    const audioB = formData.get("audioB") as File | null;

    if (!sessionStr) {
      return NextResponse.json({ error: "Missing session" }, { status: 400 });
    }

    const session = JSON.parse(sessionStr);
    const pinata = getPinata();
    const id = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    const gateway = process.env.PINATA_GATEWAY!;

    // Upload local audio files to Pinata — use public IPFS gateway so new devices can fetch without auth
    if (audioA && session.deckA) {
      const upload = await pinata.upload.public.file(audioA)
        .name(`session-${id}-a`)
        .keyvalues({ type: "driftwave-session-audio", sessionId: id });
      session.deckA.audioUrl = `https://gateway.pinata.cloud/ipfs/${upload.cid}`;
    }
    if (audioB && session.deckB) {
      const upload = await pinata.upload.public.file(audioB)
        .name(`session-${id}-b`)
        .keyvalues({ type: "driftwave-session-audio", sessionId: id });
      session.deckB.audioUrl = `https://gateway.pinata.cloud/ipfs/${upload.cid}`;
    }

    // Store session as a JSON file on Pinata
    const jsonBlob = new Blob([JSON.stringify({ ...session, id })], { type: "application/json" });
    const jsonFile = new File([jsonBlob], `session-${id}.json`, { type: "application/json" });
    await pinata.upload.public.file(jsonFile)
      .name(`session-${id}`)
      .keyvalues({ type: "driftwave-session", sessionId: id, createdAt: new Date().toISOString() });

    return NextResponse.json({ id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Share failed";
    console.error("session POST error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    const pinata = getPinata();
    const result = await pinata.files.public.list().keyvalues({ type: "driftwave-session", sessionId: id });
    const files = result.files;
    if (!files?.length) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const gateway = process.env.PINATA_GATEWAY!;
    const url = `https://${gateway}/files/${files[0].cid}`;
    const res = await fetch(url);
    const session = await res.json();
    return NextResponse.json(session);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
