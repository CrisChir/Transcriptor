#!/usr/bin/env bash
# Build the Transcriptor CoreML ASR engine on macOS (Apple Silicon).
# No Homebrew required. Only the Xcode Command Line Tools (Swift + python3)
# are needed: xcode-select --install
#
# - clones and builds the FluidAudio CLI (Swift, Core ML)
# - creates a Python virtualenv for the engine HTTP service
# - optionally warms up the models (downloads several GB on first run)
#
# ffmpeg is OPTIONAL: without it, FluidAudio decodes and resamples audio by
# itself. Install it (brew install ffmpeg, a static build, or MacPorts) only
# for the widest input-format compatibility.
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

echo "-- Checking developer tools (no Homebrew required)"
if ! command -v swift >/dev/null 2>&1; then
  echo "Swift not found. Install the Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found. Install the Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
fi
if command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg found: uploads will be normalized to 16 kHz mono WAV."
else
  echo "ffmpeg NOT found (optional): fluidaudiocli will decode audio directly."
  echo "  For the widest format support install ffmpeg later (brew, static build, or MacPorts)."
fi
if ! command -v git >/dev/null 2>&1; then
  echo "git not found. Install the Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
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
  SILENCE=/tmp/transcriptor_silence.wav
  .venv/bin/python -c "import wave; w=wave.open('$SILENCE','wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(b'\x00\x00' * 32000); w.close()"
  "$CLI" transcribe "$SILENCE" >/dev/null 2>&1 || echo "(parakeet warm-up returned non-zero; continuing)"
  "$CLI" nemotron35-transcribe "$SILENCE" >/dev/null 2>&1 || echo "(nemotron warm-up returned non-zero; continuing)"
  rm -f "$SILENCE"
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
