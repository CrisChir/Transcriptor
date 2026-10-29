#!/usr/bin/env bash
# One-command start: CoreML engine (macOS host) + web GUI (Docker).
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${ENGINE_PORT:-8760}"
HOST="${ENGINE_HOST:-0.0.0.0}"

echo "== 1/2 CoreML ASR engine (host) =="
if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "Engine already running on port $PORT."
else
  if [[ ! -d engine/.venv ]]; then
    echo "Engine not installed. Running setup first..."
    bash engine/setup.sh
  fi
  ( cd engine && ENGINE_HOST="$HOST" ENGINE_PORT="$PORT" bash run.sh ) &
  echo "Engine starting in the background."
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi

echo "== 2/2 Web GUI (Docker) =="
docker compose up -d --build

echo
echo "Transcriptor is starting:"
echo "  GUI:        http://localhost:7860"
echo "  Engine:     http://localhost:$PORT/health"
echo
echo "Logs: docker compose logs -f"
