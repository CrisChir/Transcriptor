#!/usr/bin/env bash
# Run the Transcriptor web app natively on macOS (no Docker).
# The CoreML engine (engine/run.sh) must run in another terminal.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -d .venv-web ]]; then
  python3 -m venv .venv-web
fi
.venv-web/bin/pip install --upgrade pip >/dev/null
.venv-web/bin/pip install -r app/requirements.txt

export ASR_ENGINE_URL="${ASR_ENGINE_URL:-http://127.0.0.1:8765}"
export SUPERTONIC_MODEL_DIR="${SUPERTONIC_MODEL_DIR:-$(pwd)/models/supertonic}"

echo "Downloading Supertonic assets if needed..."
(cd app && ../.venv-web/bin/python download_assets.py)

echo "Web app on http://localhost:7860 (engine: $ASR_ENGINE_URL)"
(cd app && exec ../.venv-web/bin/python -m uvicorn main:app --host 127.0.0.1 --port 7860)
