import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { writeFile, readFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { PinataSDK } from "pinata";

export const maxDuration = 300;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require("ffmpeg-static");

function getPinata() {
  return new PinataSDK({
    pinataJwt: process.env.PINATA_JWT!,
    pinataGateway: process.env.PINATA_GATEWAY!,
  });
}

function runFfmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve({ stdout, stderr });
    });
  });
}

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to parse request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const audioCid = formData.get("audioCid") as string | null;
  const imageFile = formData.get("image") as File | null;
  const artist = (formData.get("artist") as string) || "UNKNOWN";
  const title = (formData.get("title") as string) || "UNTITLED";

  if (!audioCid) {
    return NextResponse.json({ error: "Missing audioCid" }, { status: 400 });
  }
  if (!imageFile) {
    return NextResponse.json({ error: "Missing cover image" }, { status: 400 });
  }

  const gateway = process.env.PINATA_GATEWAY!;
  const id = crypto.randomUUID();
  const tmp = tmpdir();
  const audioPath = join(tmp, `${id}-audio.webm`);
  const imgPath = join(tmp, `${id}-cover.png`);
  const outPath = join(tmp, `${id}-output.mp4`);

  try {
    // Download audio from Pinata, write cover directly
    console.log("Downloading audio from Pinata...");
    const [audioRes, imgData] = await Promise.all([
      fetch(`https://${gateway}/files/${audioCid}`),
      imageFile.arrayBuffer(),
    ]);

    if (!audioRes.ok) throw new Error(`Failed to download audio: ${audioRes.status}`);
    const audioData = await audioRes.arrayBuffer();
    console.log("Audio size:", audioData.byteLength, "Image size:", imgData.byteLength);

    await Promise.all([
      writeFile(audioPath, Buffer.from(audioData)),
      writeFile(imgPath, Buffer.from(imgData)),
    ]);

    // Generate video
    console.log("Running ffmpeg...");
    await runFfmpeg([
      "-y",
      "-loop", "1",
      "-i", imgPath,
      "-i", audioPath,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-tune", "stillimage",
      "-c:a", "aac",
      "-b:a", "192k",
      "-pix_fmt", "yuv420p",
      "-vf", "scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:black",
      "-shortest",
      "-movflags", "+faststart",
      outPath,
    ]);

    console.log("FFmpeg done, reading output...");
    const videoData = await readFile(outPath);
    console.log("Video size:", videoData.length, "bytes");

    // Upload to Pinata
    console.log("Uploading to gallery...");
    const pinata = getPinata();
    const videoFile = new File([videoData], `${id}.mp4`, { type: "video/mp4" });
    const upload = await pinata.upload.public.file(videoFile)
      .name(`driftwave-export-${id}.mp4`)
      .keyvalues({
        type: "driftwave-video",
        artist,
        title,
        createdAt: new Date().toISOString(),
      });

    const videoUrl = `https://${gateway}/files/${upload.cid}`;
    console.log("Uploaded to Pinata:", videoUrl);

    // Cleanup
    await Promise.all([
      unlink(audioPath).catch(() => {}),
      unlink(imgPath).catch(() => {}),
      unlink(outPath).catch(() => {}),
    ]);

    return NextResponse.json({ url: videoUrl });
  } catch (e) {
    await Promise.all([
      unlink(audioPath).catch(() => {}),
      unlink(imgPath).catch(() => {}),
      unlink(outPath).catch(() => {}),
    ]);

    const msg = e instanceof Error ? e.message : "Video generation failed";
    console.error("generate-video error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
