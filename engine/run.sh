#!/usr/bin/env bash
# Start the Transcriptor CoreML ASR engine (macOS host, port 8765).
# Binds to 0.0.0.0 by default so the Docker container can reach it through
# host.docker.internal. For native-only use, run with ENGINE_HOST=127.0.0.1.
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -d .venv ]]; then
  echo "Engine environment missing. Run: bash engine/setup.sh" >&2
  exit 1
fi
if [[ ! -f vendor/FluidAudio/.build/release/fluidaudiocli ]]; then
  echo "fluidaudiocli missing. Run: bash engine/setup.sh" >&2
  exit 1
fi

HOST="${ENGINE_HOST:-0.0.0.0}"
PORT="${ENGINE_PORT:-8760}"
echo "Starting CoreML ASR engine on $HOST:$PORT ..."
exec .venv/bin/python -m uvicorn main:app --host "$HOST" --port "$PORT"
