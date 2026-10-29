"""HTTP client for the CoreML ASR engine running on the macOS host."""

import os

import httpx

ASR_ENGINE_URL = os.environ.get("ASR_ENGINE_URL", "http://host.docker.internal:8765")
ASR_TIMEOUT = float(os.environ.get("ASR_TIMEOUT", "3600"))


async def engine_health() -> dict:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(ASR_ENGINE_URL.rstrip("/") + "/health")
            if r.status_code == 200:
                return {"reachable": True, "detail": r.json()}
            return {"reachable": False, "detail": "HTTP " + str(r.status_code)}
    except Exception as exc:  # noqa: BLE001
        return {"reachable": False, "detail": str(exc)}


async def transcribe(filename: str, content: bytes, content_type, model: str) -> dict:
    """Forward an uploaded file to the engine and return its JSON response."""
    async with httpx.AsyncClient(timeout=ASR_TIMEOUT) as client:
        r = await client.post(
            ASR_ENGINE_URL.rstrip("/") + "/asr",
            files={"file": (filename, content, content_type or "application/octet-stream")},
            data={"model": model},
        )
        if r.status_code != 200:
            detail = None
            try:
                detail = r.json().get("detail")
            except Exception:  # noqa: BLE001
                detail = r.text[:500]
            raise RuntimeError(detail or ("Engine error (HTTP " + str(r.status_code) + ")"))
        return r.json()
