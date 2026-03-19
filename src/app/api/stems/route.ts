import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
const DEMUCS_MODEL = "cjwbw/demucs:25a173108cff36ef9f80f854c162d01df9e6528be175794b81571f6e5d7ce0e8";

export async function POST(req: NextRequest) {
  if (!REPLICATE_TOKEN) {
    return NextResponse.json({ error: "REPLICATE_API_TOKEN not configured" }, { status: 500 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("audio") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No audio file" }, { status: 400 });
    }

    // Upload file to Replicate
    const uploadRes = await fetch("https://api.replicate.com/v1/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_TOKEN}`,
      },
      body: (() => {
        const fd = new FormData();
        fd.append("content", file, file.name || "audio.mp3");
        return fd;
      })(),
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      return NextResponse.json({ error: `File upload failed: ${text}` }, { status: 502 });
    }

    const uploadData = await uploadRes.json();
    const fileUrl = uploadData.urls?.get;

    if (!fileUrl) {
      return NextResponse.json({ error: "File upload returned no URL" }, { status: 502 });
    }

    // Create prediction
    const version = DEMUCS_MODEL.split(":")[1];

    const predRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version,
        input: {
          audio: fileUrl,
          stem: "none",
        },
      }),
    });

    if (!predRes.ok) {
      const text = await predRes.text();
      return NextResponse.json({ error: `Prediction create failed: ${text}` }, { status: 502 });
    }

    let prediction = await predRes.json();

    // Poll for completion
    const pollUrl = prediction.urls?.get;
    if (!pollUrl) {
      return NextResponse.json({ error: "No poll URL returned" }, { status: 502 });
    }

    const deadline = Date.now() + 280_000; // 280s max
    while (prediction.status !== "succeeded" && prediction.status !== "failed") {
      if (Date.now() > deadline) {
        return NextResponse.json({ error: "Stem separation timed out" }, { status: 504 });
      }

      await new Promise((r) => setTimeout(r, 3000));

      const pollRes = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` },
      });
      prediction = await pollRes.json();
    }

    if (prediction.status === "failed") {
      return NextResponse.json(
        { error: prediction.error || "Demucs model failed" },
        { status: 502 }
      );
    }

    // Output is an object with stem URLs: { vocals, drums, bass, other }
    // or a single URL if stem was specified
    const output = prediction.output;

    if (!output) {
      return NextResponse.json({ error: "No output from model" }, { status: 502 });
    }

    // Return URLs — client will fetch audio directly from Replicate CDN
    return NextResponse.json({
      vocals: output.vocals || null,
      drums: output.drums || null,
      bass: output.bass || null,
      other: output.other || null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Stem separation failed" },
      { status: 500 }
    );
  }
}
