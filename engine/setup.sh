#!/usr/bin/env bash
# Build the Transcriptor CoreML ASR engine on macOS (Apple Silicon).
# - clones and builds the FluidAudio CLI (Swift, Core ML)
# - creates a Python virtualenv for the engine HTTP service
# - optionally warms up the models (downloads several GB on first run)
set -euo pipefail
cd "$(dirname "$0")"

REF="${FLUIDAUDIO_REF:-main}"
WARMUP=1
if [[ "${1:-}" == "--skip-warmup" ]]; then WARMUP=0; fi

echo "== Transcriptor engine setup =="

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: the CoreML engine must run on macOS (Apple Silicon)." >&2
  exit 1
fi
if [[ "$(uname -m)" != "arm64" ]]; then
  echo "ERROR: Apple Silicon (arm64) Mac required for the Core ML models." >&2
  exit 1
fi

echo "-- Checking developer tools"
if ! command -v swift >/dev/null 2>&1; then
  echo "Swift not found. Install the Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
fi
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew not found. Install it from https://brew.sh" >&2
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "-- Installing ffmpeg"
  brew install ffmpeg
fi

echo "-- Building FluidAudio CLI (ref: $REF)"
mkdir -p vendor
if [[ ! -d vendor/FluidAudio ]]; then
  git clone --depth 1 https://github.com/FluidInference/FluidAudio.git vendor/FluidAudio
fi
(
  cd vendor/FluidAudio
  git fetch --depth 1 origin "$REF"
  git reset --hard FETCH_HEAD
  swift build -c release
)
CLI="vendor/FluidAudio/.build/release/fluidaudiocli"
echo "CLI ready: $CLI"

echo "-- Creating the engine Python environment"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
.venv/bin/pip install --upgrade pip >/dev/null
.venv/bin/pip install -r requirements.txt

if [[ "$WARMUP" == "1" ]]; then
  echo "-- Warm-up: downloading models (several GB on first run; the Nemotron"
  echo "   diarizer also compiles once for the Neural Engine, ~80 s)."
  ffmpeg -nostdin -y -loglevel error -f lavfi -i anullsrc=r=16000:cl=mono -t 2 /tmp/transcriptor_silence.wav
  "$CLI" transcribe /tmp/transcriptor_silence.wav >/dev/null 2>&1 || echo "(parakeet warm-up returned non-zero; continuing)"
  "$CLI" nemotron35-transcribe /tmp/transcriptor_silence.wav >/dev/null 2>&1 || echo "(nemotron warm-up returned non-zero; continuing)"
  rm -f /tmp/transcriptor_silence.wav
  echo "-- Warm-up done"
fi

echo
echo "Engine setup complete."
echo
echo "Next steps:"
echo "  bash engine/run.sh             # start the engine (port 8765)"
echo "  docker compose up -d --build   # start the web GUI (port 7860)"
echo "  open http://localhost:7860"
echo
