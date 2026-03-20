import { NextResponse } from "next/server";
import { PinataSDK } from "pinata";

function getPinata() {
  return new PinataSDK({
    pinataJwt: process.env.PINATA_JWT!,
    pinataGateway: process.env.PINATA_GATEWAY!,
  });
}

export async function GET() {
  try {
    const pinata = getPinata();
    const result = await pinata.files.public.list()
      .keyvalues({ type: "driftwave-video" })
      .order("DESC")
      .limit(50);

    const items = result.files.map((f) => ({
      id: f.id,
      cid: f.cid,
      url: `https://${process.env.PINATA_GATEWAY}/files/${f.cid}`,
      artist: f.keyvalues?.artist || "UNKNOWN",
      title: f.keyvalues?.title || "UNTITLED",
      createdAt: f.keyvalues?.createdAt || f.created_at,
    }));

    return NextResponse.json({ items });
  } catch (e) {
    console.error("gallery error:", e);
    return NextResponse.json({ items: [], error: "Failed to load gallery" });
  }
}
