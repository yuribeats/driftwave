"""
Driftwave stem separator — Modal serverless endpoint.
Demucs htdemucs_ft on A10G GPU. Stems encoded to 192kbps MP3 and
uploaded directly to Pinata. Pinata credentials passed in request body.

Deploy: modal deploy modal_functions/stems.py
"""

import modal

app = modal.App("driftwave-stems")

image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install("numpy<2.0")
    .pip_install(
        "torch==2.2.2",
        "torchaudio==2.2.2",
        extra_options="--index-url https://download.pytorch.org/whl/cu118",
    )
    .pip_install("demucs", "requests", "fastapi[standard]")
)

model_volume = modal.Volume.from_name("demucs-models", create_if_missing=True)


@app.function(
    image=image,
    timeout=300,
    memory=8192,
    gpu="a10g",
    volumes={"/model-cache": model_volume},
)
@modal.fastapi_endpoint(method="POST")
def separate_stems(item: dict) -> dict:
    import os
    import subprocess
    import tempfile

    import requests as req_lib

    os.environ.setdefault("TORCH_HOME", "/model-cache/torch")

    audio_url  = item.get("audio_url")
    x_run      = item.get("x_run")
    pinata_jwt = item.get("pinata_jwt")
    pinata_gw  = item.get("pinata_gateway")

    if not audio_url:
        return {"error": "No audio_url provided"}
    if not pinata_jwt or not pinata_gw:
        return {"error": "Missing Pinata credentials"}

    # ── Download audio ───────────────────────────────────────────────────────
    dl_headers = {"X-RUN": x_run} if x_run else {}
    try:
        r = req_lib.get(audio_url, headers=dl_headers, timeout=60)
        r.raise_for_status()
    except Exception as e:
        return {"error": f"Download failed: {e}"}

    url_stem = audio_url.lower().split("?")[0]
    suffix = (
        ".wav"  if url_stem.endswith(".wav")  else
        ".flac" if url_stem.endswith(".flac") else
        ".mp3"
    )

    with tempfile.TemporaryDirectory() as tmp:
        in_path = os.path.join(tmp, f"input{suffix}")
        with open(in_path, "wb") as f:
            f.write(r.content)

        # ── Run Demucs ───────────────────────────────────────────────────────
        env = {**os.environ, "TORCH_HOME": "/model-cache/torch"}
        proc = subprocess.run(
            [
                "python", "-m", "demucs",
                "--name", "htdemucs_ft",
                "--device", "cuda",
                "-o", tmp,
                in_path,
            ],
            capture_output=True,
            text=True,
            timeout=240,
            env=env,
        )
        if proc.returncode != 0:
            return {"error": f"Demucs failed: {proc.stderr[-600:]}"}

        # Output: <tmp>/htdemucs_ft/input/{vocals,drums,bass,other}.wav
        stem_dir = os.path.join(tmp, "htdemucs_ft", "input")
        if not os.path.isdir(stem_dir):
            return {"error": f"No demucs output dir — stderr: {proc.stderr[-300:]}"}

        # ── Encode to MP3 and upload each stem to Pinata ─────────────────────
        urls: dict = {}
        for stem in ["vocals", "drums", "bass", "other"]:
            wav = os.path.join(stem_dir, f"{stem}.wav")
            if not os.path.exists(wav):
                urls[stem] = None
                continue

            mp3 = os.path.join(tmp, f"{stem}.mp3")
            subprocess.run(
                ["ffmpeg", "-i", wav, "-b:a", "192k", "-y", mp3],
                capture_output=True,
                timeout=60,
            )
            upload_path = mp3 if os.path.exists(mp3) else wav
            mime = "audio/mpeg" if upload_path.endswith(".mp3") else "audio/wav"

            with open(upload_path, "rb") as f:
                data = f.read()

            try:
                up = req_lib.post(
                    "https://uploads.pinata.cloud/v3/files",
                    headers={"Authorization": f"Bearer {pinata_jwt}"},
                    files={"file": (f"{stem}.mp3", data, mime)},
                    timeout=120,
                )
                up.raise_for_status()
                cid = up.json()["data"]["cid"]
                urls[stem] = f"{pinata_gw}/ipfs/{cid}"
            except Exception as e:
                urls[stem] = None

        return urls
