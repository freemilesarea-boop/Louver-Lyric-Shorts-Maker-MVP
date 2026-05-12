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
# Phase 5-8.1 CI fix — self-diagnose ABORT lines so future failures
# point at the exact line + exit code instead of bash's generic "exit 2".
trap 'echo "fetch-whisper: ABORT at line $LINENO (exit $?)" >&2' ERR

# ---- Configuration --------------------------------------------------
# Pin a known-good whisper.cpp release. Update this single line to bump
# the bundled version; everything else flows from it.
#
# Phase 5-8.1: bumped v1.7.4 → v1.8.4. v1.7.4 was published before the
# repository moved from ggerganov/whisper.cpp → ggml-org/whisper.cpp,
# and the v1.7.4 release page on the new org has zero Windows assets
# (404). v1.8.4 publishes whisper-bin-x64.zip + whisper-blas-bin-x64.zip
# alongside the source tarball, so Windows can use the prebuilt path
# and macOS/Linux can clone the new-org URL directly.
WHISPER_RELEASE="${WHISPER_RELEASE:-v1.8.4}"
# Default model. ggml-base.bin (~150 MB) trades size for accuracy. Set
# WHISPER_MODEL=tiny for ggml-tiny.bin (~75 MB) on size-constrained CI.
WHISPER_MODEL="${WHISPER_MODEL:-base}"

# Upstream repo. The old `ggerganov/whisper.cpp` URL still 301-redirects
# but a fresh clone is cleaner against the canonical name.
WHISPER_REPO="${WHISPER_REPO:-https://github.com/ggml-org/whisper.cpp}"

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
      # Phase 5-8.1: try the canonical prebuilt first; if the pinned
      # release doesn't have a Windows asset (the v1.7.4 → v1.8.x
      # rename was missing whisper-bin-x64.zip on the new org), retry
      # the BLAS-enabled zip and finally fall back to the most recent
      # release's prebuilt. Verbose: every step echoes its URL so a CI
      # log makes the trail debuggable.
      local urls=(
        "${WHISPER_BIN_URL:-${WHISPER_REPO}/releases/download/${WHISPER_RELEASE}/whisper-bin-x64.zip}"
        "${WHISPER_REPO}/releases/download/${WHISPER_RELEASE}/whisper-blas-bin-x64.zip"
      )
      local downloaded=""
      for url in "${urls[@]}"; do
        echo "fetch-whisper: trying prebuilt $url"
        if curl -fsSL --retry 3 -A 'Mozilla/5.0 (whisper-fetcher)' \
             -o "$ARCHIVE" "$url"; then
          downloaded="$url"; break
        fi
        echo "fetch-whisper: ↳ skipped (curl non-zero)"
      done
      if [ -z "$downloaded" ]; then
        echo "fetch-whisper: no Windows prebuilt found at $WHISPER_RELEASE — Windows requires a release with whisper-bin-x64.zip." >&2
        echo "fetch-whisper: pinned releases since the org rename are v1.8.x; bump WHISPER_RELEASE if v$WHISPER_RELEASE was the problem." >&2
        exit 1
      fi
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
      # Bundle the .dll runtime files alongside the binary — the
      # upstream zip ships whisper.dll / ggml*.dll which the exe loads
      # at runtime. Without them whisper-cli.exe fails with
      # "ggml.dll not found".
      while IFS= read -r dll; do
        cp "$dll" "$BIN_DIR/$PLATFORM/"
      done < <(find "$extract" -type f -iname '*.dll')
      ;;
    darwin-arm64|darwin-x64|linux-x64)
      # Build from source — upstream prebuilds for *nix aren't reliably
      # published. Requires cmake + make + a C++ compiler on the runner.
      #
      # CRITICAL: -DBUILD_SHARED_LIBS=OFF. A default cmake build links
      # against libwhisper.so + libggml*.so files in the build tree; if
      # we copy only the executable into resources/ the runtime can't
      # find its shared deps and `Whisper not found` errors back to the
      # renderer. Static build folds everything into a single ~10-15 MB
      # binary that doesn't need code-signing of any sidecar libraries
      # (matters on macOS where Gatekeeper checks every .dylib).
      #
      # Phase 5-8.1: do NOT silence cmake's stdout — when this failed
      # in CI under the previous version the `>/dev/null` redirect ate
      # the only useful diagnostic ("Process completed with exit 2"
      # was bash's view of a swallowed cmake error). Verbose output
      # is cheap in a CI log; opaque builds are not.
      echo "fetch-whisper: building whisper.cpp $WHISPER_RELEASE from source (static) for $PLATFORM"
      echo "fetch-whisper: repo=$WHISPER_REPO"
      local src="$ROOT_DIR/.cache/whisper-cpp-${WHISPER_RELEASE}"
      if [ ! -d "$src" ]; then
        git clone --depth 1 --branch "$WHISPER_RELEASE" "$WHISPER_REPO" "$src"
      fi
      (
        cd "$src"
        rm -rf build
        cmake -B build -DCMAKE_BUILD_TYPE=Release \
          -DBUILD_SHARED_LIBS=OFF \
          -DGGML_STATIC=ON \
          -DWHISPER_BUILD_EXAMPLES=ON
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
      # Sanity check: ldd / otool should report zero non-system deps.
      # We don't hard-fail on this (different `ldd` flavors disagree)
      # but the log makes it easy to spot a regression.
      if command -v ldd >/dev/null 2>&1; then
        echo "fetch-whisper: deps reported by ldd:"
        ldd "$BIN_OUT" || true
      elif command -v otool >/dev/null 2>&1; then
        echo "fetch-whisper: deps reported by otool -L:"
        otool -L "$BIN_OUT" || true
      fi
      ;;
  esac
}

if [ ! -f "$BIN_OUT" ]; then
  fetch_prebuilt_or_build
fi

# ---- Model ---------------------------------------------------------
# Huggingface's CDN refuses curl's default UA with 403 ("anti-bot").
# Pretend to be a stock browser; the model files are licensed for
# redistribution (MIT) so this isn't a TOS issue.
if [ ! -f "$MODEL_OUT" ]; then
  MODEL_URL="${WHISPER_MODEL_URL:-https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL}.bin}"
  echo "fetch-whisper: downloading model $MODEL_URL"
  curl -fSL --retry 3 \
    -A 'Mozilla/5.0 (whisper-fetcher) curl' \
    -o "$MODEL_OUT.part" \
    "$MODEL_URL"
  mv "$MODEL_OUT.part" "$MODEL_OUT"
fi

# ---- Sanity check + summary ----------------------------------------
echo
echo "fetch-whisper: OK"
echo "  binary:  $BIN_OUT  ($(stat -c '%s' "$BIN_OUT" 2>/dev/null || stat -f '%z' "$BIN_OUT") bytes)"
echo "  model:   $MODEL_OUT  ($(stat -c '%s' "$MODEL_OUT" 2>/dev/null || stat -f '%z' "$MODEL_OUT") bytes)"
