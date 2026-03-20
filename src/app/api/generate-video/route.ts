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
  const formData = await request.formData();
  const audioFile = formData.get("audio") as File | null;
  const imageFile = formData.get("image") as File | null;
  const artist = (formData.get("artist") as string) || "UNKNOWN";
  const title = (formData.get("title") as string) || "UNTITLED";

  if (!audioFile || !imageFile) {
    return NextResponse.json({ error: "Missing audio or image" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const tmp = tmpdir();
  const audioPath = join(tmp, `${id}-audio.wav`);
  const imgPath = join(tmp, `${id}-cover.png`);
  const outPath = join(tmp, `${id}-output.mp4`);

  try {
    const [audioData, imgData] = await Promise.all([
      audioFile.arrayBuffer(),
      imageFile.arrayBuffer(),
    ]);

    await Promise.all([
      writeFile(audioPath, Buffer.from(audioData)),
      writeFile(imgPath, Buffer.from(imgData)),
    ]);

    console.log("Running ffmpeg...");
    await runFfmpeg([
      "-y",
      "-loop", "1",
      "-i", imgPath,
      "-i", audioPath,
      "-c:v", "libx264",
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

    // Upload to Pinata instead of returning raw binary (avoids Vercel body size limit)
    console.log("Uploading to Pinata...");
    const pinata = getPinata();
    const videoFile = new File([videoData], `${id}.mp4`, { type: "video/mp4" });
    const upload = await pinata.upload.public.file(videoFile)
      .name(`driftwave-export-${id}.mp4`)
      .keyvalues({
        type: "driftwave-video",
        artist: artist,
        title: title,
        createdAt: new Date().toISOString(),
      });

    const videoUrl = `https://${process.env.PINATA_GATEWAY}/files/${upload.cid}`;
    console.log("Uploaded to Pinata:", videoUrl);

    // Cleanup temp files
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

    console.error("generate-video error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Video generation failed" },
      { status: 500 }
    );
  }
}
