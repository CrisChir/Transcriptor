"""Transcriptor CoreML ASR engine - native macOS host service.

Wraps the FluidAudio CLI (Swift / Core ML / Apple Neural Engine) behind a small
HTTP API so the Dockerized web app can reach it at
http://host.docker.internal:8765.

Why a host service: Docker Desktop on macOS runs Linux ARM64 containers inside a
virtual machine. Core ML and the Apple Neural Engine are macOS-only frameworks
and are not visible inside Linux containers, so CoreML inference must run on
the macOS host and be exposed over HTTP.

ffmpeg is OPTIONAL: when present, uploads are normalized to 16 kHz mono WAV
before inference (widest format compatibility); when absent, the original file
is passed to fluidaudiocli, which decodes and resamples audio itself.
"""

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

ENGINE_PORT = int(os.environ.get("ENGINE_PORT", "8765"))
FLUIDAUDIO_CLI = Path(os.environ.get(
    "FLUIDAUDIO_CLI",
    str(Path(__file__).resolve().parent / "vendor" / "FluidAudio" / ".build" / "release" / "fluidaudiocli"),
))
ASR_TIMEOUT = int(os.environ.get("ASR_TIMEOUT", "3600"))
HAVE_FFMPEG = shutil.which("ffmpeg") is not None

MODELS: Dict[str, Dict[str, Any]] = {
    "parakeet-v3": {
        "label": "Parakeet TDT v3 (0.6B) - multilingual",
        "languages": "25 European languages, including Romanian",
        "speakers": False,
        "cli": "transcribe",
        "extra_args": [],
        "note": "Default FluidAudio batch model. Best choice for Romanian audio.",
    },
    "parakeet-v2-en": {
        "label": "Parakeet TDT v2 - English, higher accuracy",
        "languages": "English",
        "speakers": False,
        "cli": "transcribe",
        "extra_args": ["--model-version", "v2"],
        "note": "English-only model with higher accuracy.",
    },
    "parakeet-unified-en": {
        "label": "Parakeet Unified - English, punctuation + casing",
        "languages": "English",
        "speakers": False,
        "cli": "transcribe",
        "extra_args": ["--model-version", "unified"],
        "note": "English with punctuation and capitalization, word timings in JSON.",
    },
    "nemotron35-en": {
        "label": "Nemotron 3.5 Transcribe Lite - English meetings with speakers",
        "languages": "English (validated)",
        "speakers": True,
        "cli": "nemotron35-transcribe",
        "extra_args": [],
        "note": (
            "~600M ASR encoder + CTC head from NVIDIA Nemotron 3.5 Transcribe "
            "(Core ML port by FluidInference), with Nemotron-3-Diarization on "
            "the Neural Engine. Extremely fast speaker-labelled transcripts."
        ),
    },
}

app = FastAPI(title="Transcriptor ASR Engine", version="1.0.0")


def require_cli() -> Path:
    if not FLUIDAUDIO_CLI.exists():
        raise HTTPException(
            503,
            "fluidaudiocli not found at " + str(FLUIDAUDIO_CLI)
            + " - run engine/setup.sh or set FLUIDAUDIO_CLI",
        )
    return FLUIDAUDIO_CLI


def run_cli(cmd: List[str]):
    start = time.time()
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=ASR_TIMEOUT)
    return proc, round(time.time() - start, 2)


def convert_to_wav16k(src: Path, dst: Path) -> None:
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i", str(src),
         "-vn", "-ac", "1", "-ar", "16000", str(dst)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise HTTPException(400, "ffmpeg failed to decode the file: " + proc.stderr.strip()[:400])


# Fallback transcript extraction from CLI stdout, in case --output-json is
# unsupported by the installed FluidAudio build.
NOISE = re.compile(
    r"(?i)^[ \t\s\[\(]*(loading|download|model|rtfx|real[ -]?time|duration|elapsed|"
    r"transcrib(ed|ing)|tokens|audio|chunk|stream|initializ|warm)",
)


def clean_stdout(text: str) -> str:
    lines = [ln for ln in text.splitlines() if ln.strip() and not NOISE.match(ln.strip())]
    return "\n".join(lines).strip()


def transcript_from_json(path: Path) -> Optional[str]:
    """Generic extraction: works with different --output-json schemas."""
    try:
        data = json.loads(path.read_text())
    except Exception:  # noqa: BLE001
        return None
    if isinstance(data, dict):
        for key in ("text", "transcript", "transcription", "finalTranscript", "result"):
            v = data.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
        segments = data.get("segments") or data.get("words")
        if isinstance(segments, list) and segments:
            parts = []
            for s in segments:
                if isinstance(s, dict):
                    piece = s.get("text", s.get("w"))
                    if isinstance(piece, str):
                        parts.append(piece)
            if parts:
                return " ".join(p.strip() for p in parts if p.strip())
    return None


def parse_words(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
    except Exception:  # noqa: BLE001
        return []
    if isinstance(data, dict):
        data = data.get("words", [])
    words: List[Dict[str, Any]] = []
    for w in data or []:
        if not isinstance(w, dict):
            continue
        t = w.get("t", w.get("start", 0.0))
        spk = w.get("spk")
        txt = w.get("w", w.get("word", ""))
        try:
            words.append({"t": float(t or 0.0), "spk": spk, "w": str(txt)})
        except (TypeError, ValueError):
            continue
    return words


def turns_from_words(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    groups: List[Dict[str, Any]] = []
    for w in words:
        if not str(w.get("w", "")).strip():
            continue
        label = w.get("spk")
        if groups and groups[-1]["speaker"] == label:
            groups[-1]["words"].append(w)
        else:
            groups.append({"speaker": label, "start": w["t"], "words": [w]})
    turns = []
    for g in groups:
        text = " ".join(x["w"] for x in g["words"]).strip()
        if not text:
            continue
        if isinstance(g["speaker"], int) and g["speaker"] >= 0:
            name = "Speaker " + str(g["speaker"] + 1)
        else:
            name = "Speaker ?"
        turns.append({"speaker": name, "start": g["start"], "text": text})
    return turns


def fmt_start(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    return str(m) + ":" + str(s).zfill(2)


@app.get("/health")
async def health():
    return {
        "ok": True,
        "cli": str(FLUIDAUDIO_CLI),
        "cli_exists": FLUIDAUDIO_CLI.exists(),
        "ffmpeg": HAVE_FFMPEG,
        "ffmpeg_note": None if HAVE_FFMPEG else "ffmpeg not found (optional): passing original files to fluidaudiocli",
        "models": sorted(MODELS.keys()),
    }


@app.get("/models")
async def models():
    return {k: {kk: vv for kk, vv in v.items() if kk != "extra_args"} for k, v in MODELS.items()}


@app.post("/asr")
async def asr(file: UploadFile = File(...), model: str = Form("parakeet-v3")):
    if model not in MODELS:
        raise HTTPException(400, "Unknown model: " + model + ". Use one of: " + ", ".join(MODELS))
    cli = require_cli()

    suffix = Path(file.filename or "audio").suffix or ".bin"
    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        src = work / ("upload" + suffix)
        wav = work / "audio16k.wav"

        with src.open("wb") as out:
            shutil.copyfileobj(file.file, out)

        # ffmpeg is optional: with it, normalize to 16 kHz mono WAV; without
        # it, fluidaudiocli decodes and resamples the original file itself.
        if HAVE_FFMPEG:
            convert_to_wav16k(src, wav)
            audio = wav
        else:
            audio = src

        spec = MODELS[model]

        if model == "nemotron35-en":
            words_path = work / "words.json"
            txt_path = work / "transcript.txt"
            cmd = [str(cli), spec["cli"], str(audio), "--out", str(txt_path), "--json", str(words_path)]
            proc, elapsed = run_cli(cmd)
            if proc.returncode != 0:
                raise HTTPException(500, "fluidaudiocli failed: " + (proc.stderr.strip()[-600:] or proc.stdout.strip()[-600:]))
            words = parse_words(words_path)
            turns = turns_from_words(words)
            plain = "\n".join(t["text"] for t in turns)
            if not plain and txt_path.exists():
                plain = txt_path.read_text().strip()
            transcript = "\n".join(
                "[" + fmt_start(t["start"]) + "] " + t["speaker"] + ": " + t["text"] for t in turns
            ) or plain
            return {
                "model": model,
                "transcript": transcript,
                "plain_text": plain,
                "turns": turns,
                "word_count": len(words),
                "elapsed_s": elapsed,
                "raw_output": proc.stdout,
            }

        # Parakeet family: prefer --output-json, fall back to stdout.
        cmd = [str(cli), spec["cli"], str(audio)] + spec["extra_args"]
        out_json = work / "asr.json"
        proc, elapsed = run_cli(cmd + ["--output-json", str(out_json)])
        transcript = None
        if proc.returncode == 0 and out_json.exists():
            transcript = transcript_from_json(out_json)
        if transcript is None:
            proc, elapsed = run_cli(cmd)
            if proc.returncode != 0:
                raise HTTPException(500, "fluidaudiocli failed: " + (proc.stderr.strip()[-600:] or proc.stdout.strip()[-600:]))
            transcript = clean_stdout(proc.stdout)

        return {
            "model": model,
            "transcript": transcript,
            "turns": [],
            "elapsed_s": elapsed,
            "raw_output": proc.stdout,
        }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.environ.get("ENGINE_HOST", "0.0.0.0"), port=ENGINE_PORT)
