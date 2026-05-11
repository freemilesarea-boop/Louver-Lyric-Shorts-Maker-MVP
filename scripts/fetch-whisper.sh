#!/usr/bin/env bash
# Phase 5-7: download bundled whisper.cpp binaries + ggml model into
# resources/whisper/ so end-user installers ship with AI lyric extraction
# baked in (no separate `pip install openai-whisper` required).
#
# Layout produced (mirrors detectWhisperBinary's lookup order):
#   resources/whisper/bin/<plat>/whisper-cli[.exe]
#   resources/whisper/models/ggml-base.bin
#
# The runtime detector (src/main/audio/transcribe.ts) checks the bundled
# path first, then PATH, then surfaces a friendly "not installed" message.
# Pinning the upstream version below gives reproducible CI builds — bump
# WHISPER_RELEASE when you want a newer whisper.cpp.
#
# Why a shell script (not a node fetcher)?
# whisper.cpp ships per-OS prebuilt zips on its GitHub releases page; we
# only need to grab one of them per CI runner. Curl + unzip + chmod +x is
# enough and avoids pulling extra npm deps into the build matrix.
#
# Usage:
#   scripts/fetch-whisper.sh                    # auto-detect host OS
#   FORCE_PLATFORM=darwin-arm64 scripts/fetch-whisper.sh  # cross-fetch
#
# The script is idempotent — if the binary + model already exist on disk
# it short-circuits and exits 0.

set -euo pipefail

# ---- Configuration --------------------------------------------------
# Pin a known-good whisper.cpp release. Update this single line to bump
# the bundled version; everything else flows from it.
WHISPER_RELEASE="${WHISPER_RELEASE:-v1.7.4}"
# Default model. ggml-base.bin (~150 MB) trades size for accuracy. Set
# WHISPER_MODEL=tiny for ggml-tiny.bin (~75 MB) on size-constrained CI.
WHISPER_MODEL="${WHISPER_MODEL:-base}"

# ---- Paths ----------------------------------------------------------
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WHISPER_DIR="$ROOT_DIR/resources/whisper"
BIN_DIR="$WHISPER_DIR/bin"
MODELS_DIR="$WHISPER_DIR/models"
mkdir -p "$BIN_DIR" "$MODELS_DIR"

# ---- Detect platform ------------------------------------------------
detect_platform() {
  if [ -n "${FORCE_PLATFORM:-}" ]; then
    echo "$FORCE_PLATFORM"
    return
  fi
  case "$(uname -s)" in
    Darwin)
      if [ "$(uname -m)" = "arm64" ]; then echo "darwin-arm64"; else echo "darwin-x64"; fi ;;
    Linux)
      if [ "$(uname -m)" = "x86_64" ]; then echo "linux-x64"; else echo "linux-$(uname -m)"; fi ;;
    MINGW*|MSYS*|CYGWIN*) echo "win32-x64" ;;
    *) echo "unsupported-$(uname -s)" ;;
  esac
}

PLATFORM="$(detect_platform)"
case "$PLATFORM" in
  darwin-arm64|darwin-x64|linux-x64|win32-x64) ;;
  *)
    echo "fetch-whisper: unsupported platform '$PLATFORM' — skipping bundle." >&2
    echo "Runtime will fall back to PATH whisper or the friendly error." >&2
    exit 0
    ;;
esac

BIN_NAME="whisper-cli"
[ "$PLATFORM" = "win32-x64" ] && BIN_NAME="whisper-cli.exe"
BIN_OUT="$BIN_DIR/$PLATFORM/$BIN_NAME"
MODEL_OUT="$MODELS_DIR/ggml-${WHISPER_MODEL}.bin"

# ---- Skip if already present ---------------------------------------
if [ -f "$BIN_OUT" ] && [ -f "$MODEL_OUT" ]; then
  echo "fetch-whisper: bundle already present for $PLATFORM — nothing to do."
  exit 0
fi

mkdir -p "$BIN_DIR/$PLATFORM"

# ---- Resolve download URLs -----------------------------------------
# whisper.cpp's release page hosts pre-built archives like:
#   whisper-bin-x64.zip                (Windows x86_64)
#   whisper-blas-bin-x64.zip           (Windows x86_64 + OpenBLAS)
# For macOS / Linux the upstream typically ships only source — we build
# from source there. The build is fast (a few minutes), uses cmake +
# make, and produces a single self-contained `whisper-cli` binary.
#
# If the user overrides WHISPER_BIN_URL the script just fetches that
# archive verbatim — useful for an internal mirror or a custom build.

ARCHIVE="$ROOT_DIR/.cache/whisper-${PLATFORM}-${WHISPER_RELEASE}.tmp"
mkdir -p "$ROOT_DIR/.cache"

fetch_prebuilt_or_build() {
  case "$PLATFORM" in
    win32-x64)
      local url="${WHISPER_BIN_URL:-https://github.com/ggerganov/whisper.cpp/releases/download/${WHISPER_RELEASE}/whisper-bin-x64.zip}"
      echo "fetch-whisper: downloading prebuilt $url"
      curl -fsSL --retry 3 -o "$ARCHIVE" "$url"
      local extract="$ROOT_DIR/.cache/whisper-${PLATFORM}-extracted"
      rm -rf "$extract"
      mkdir -p "$extract"
      unzip -q "$ARCHIVE" -d "$extract"
      # Locate `whisper-cli.exe` (or older `main.exe`) in the unpacked tree.
      local found
      found="$(find "$extract" -type f \( -iname 'whisper-cli.exe' -o -iname 'main.exe' \) | head -1)"
      if [ -z "$found" ]; then
        echo "fetch-whisper: prebuilt zip didn't contain whisper-cli.exe" >&2
        exit 1
      fi
      cp "$found" "$BIN_OUT"
      ;;
    darwin-arm64|darwin-x64|linux-x64)
      # Build from source — upstream prebuilds for *nix aren't reliably
      # published. Requires cmake + make + a C++ compiler on the runner.
      echo "fetch-whisper: building whisper.cpp $WHISPER_RELEASE from source for $PLATFORM"
      local src="$ROOT_DIR/.cache/whisper-cpp-${WHISPER_RELEASE}"
      if [ ! -d "$src" ]; then
        git clone --depth 1 --branch "$WHISPER_RELEASE" \
          https://github.com/ggerganov/whisper.cpp "$src"
      fi
      (
        cd "$src"
        cmake -B build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_EXAMPLES=ON >/dev/null
        cmake --build build --config Release --target whisper-cli -j
      )
      local built
      built="$(find "$src/build" -type f -name 'whisper-cli' | head -1)"
      if [ -z "$built" ]; then
        echo "fetch-whisper: build did not produce whisper-cli" >&2
        exit 1
      fi
      cp "$built" "$BIN_OUT"
      chmod +x "$BIN_OUT"
      ;;
  esac
}

if [ ! -f "$BIN_OUT" ]; then
  fetch_prebuilt_or_build
fi

# ---- Model ---------------------------------------------------------
if [ ! -f "$MODEL_OUT" ]; then
  MODEL_URL="${WHISPER_MODEL_URL:-https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL}.bin}"
  echo "fetch-whisper: downloading model $MODEL_URL"
  curl -fsSL --retry 3 -o "$MODEL_OUT" "$MODEL_URL"
fi

# ---- Sanity check + summary ----------------------------------------
echo
echo "fetch-whisper: OK"
echo "  binary:  $BIN_OUT  ($(stat -c '%s' "$BIN_OUT" 2>/dev/null || stat -f '%z' "$BIN_OUT") bytes)"
echo "  model:   $MODEL_OUT  ($(stat -c '%s' "$MODEL_OUT" 2>/dev/null || stat -f '%z' "$MODEL_OUT") bytes)"
