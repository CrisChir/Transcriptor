"""Supertonic 3 text-to-speech wrapper (runs inside the container, CPU)."""

import os
import threading
from pathlib import Path

MODEL_DIR = Path(os.environ.get("SUPERTONIC_MODEL_DIR", "models/supertonic"))

VOICES = ["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"]

# 31 languages supported by Supertonic 3, plus the language-agnostic "na".
LANGUAGES = {
    "ro": "Romanian",
    "en": "English",
    "bg": "Bulgarian",
    "cs": "Czech",
    "da": "Danish",
    "de": "German",
    "el": "Greek",
    "es": "Spanish",
    "et": "Estonian",
    "fi": "Finnish",
    "fr": "French",
    "hi": "Hindi",
    "hr": "Croatian",
    "hu": "Hungarian",
    "id": "Indonesian",
    "it": "Italian",
    "ja": "Japanese",
    "ko": "Korean",
    "lt": "Lithuanian",
    "lv": "Latvian",
    "nl": "Dutch",
    "pl": "Polish",
    "pt": "Portuguese",
    "ru": "Russian",
    "sk": "Slovak",
    "sl": "Slovenian",
    "sv": "Swedish",
    "tr": "Turkish",
    "uk": "Ukrainian",
    "vi": "Vietnamese",
    "ar": "Arabic",
    "na": "Auto / unknown",
}

_lock = threading.Lock()
_tts = None


def get_tts():
    """Lazily initialize the Supertonic engine (single instance, thread-safe)."""
    global _tts
    if _tts is None:
        with _lock:
            if _tts is None:
                from supertonic import TTS

                _tts = TTS(
                    model="supertonic-3",
                    model_dir=str(MODEL_DIR),
                    auto_download=False,
                )
    return _tts


def tts_ready() -> bool:
    return _tts is not None


def synthesize(text: str, lang: str, voice: str, speed: float = 1.05, steps: int = 8):
    """Return (wav_path, duration_seconds). wav_path is a temporary file."""
    import tempfile

    if lang not in LANGUAGES:
        raise ValueError("Unsupported language: " + str(lang))
    if voice not in VOICES:
        raise ValueError("Unsupported voice: " + str(voice))

    with _lock:
        engine = get_tts()
        style = engine.get_voice_style(voice_name=voice)
        wav, duration = engine.synthesize(
            text=text,
            voice_style=style,
            total_steps=int(steps),
            speed=float(speed),
            lang=lang,
        )

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    engine.save_audio(wav, tmp.name)
    dur = float(duration[0]) if hasattr(duration, "__len__") else float(duration)
    return tmp.name, dur
