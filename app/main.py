"""Transcriptor web application (Docker container).

Serves the GUI, proxies transcription to the CoreML engine on the macOS host
and runs Supertonic 3 text-to-speech locally in the container.
"""

import os
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import asr
from tts import LANGUAGES, VOICES, synthesize, tts_ready

MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "500"))
MAX_TEXT_CHARS = int(os.environ.get("MAX_TEXT_CHARS", "20000"))

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title="Transcriptor", version="1.0.0")


@app.get("/api/health")
async def health():
    return {
        "asr_engine": await asr.engine_health(),
        "asr_engine_url": asr.ASR_ENGINE_URL,
        "tts_ready": tts_ready(),
    }


@app.get("/api/config")
async def config():
    return {
        "voices": VOICES,
        "languages": [{"code": c, "name": n} for c, n in LANGUAGES.items()],
        "max_upload_mb": MAX_UPLOAD_MB,
        "max_text_chars": MAX_TEXT_CHARS,
    }


@app.post("/api/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form("parakeet-v3"),
):
    content = await file.read()
    if not content:
        raise HTTPException(400, "Empty file.")
    if len(content) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, "File exceeds the " + str(MAX_UPLOAD_MB) + " MB limit.")

    try:
        result = await asr.transcribe(file.filename or "audio", content, file.content_type, model)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, "Cannot reach the ASR engine: " + str(exc))
    return result


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_TEXT_CHARS)
    lang: str = "ro"
    voice: str = "M1"
    speed: float = Field(1.05, ge=0.7, le=2.0)
    steps: int = Field(8, ge=5, le=12)


@app.post("/api/tts")
async def tts(req: SynthesizeRequest):
    try:
        wav_path, duration = synthesize(
            text=req.text.strip(),
            lang=req.lang,
            voice=req.voice,
            speed=req.speed,
            steps=req.steps,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, "TTS failed: " + str(exc))
    return FileResponse(
        wav_path,
        media_type="audio/wav",
        filename="speech.wav",
        headers={"X-Duration-Seconds": "{:.2f}".format(duration)},
    )


app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
