# Bundled Whisper

This directory holds the **bundled** whisper.cpp binary and ggml model so end
users get AI lyric extraction with zero install. The runtime detection in
`src/main/audio/transcribe.ts → detectWhisperBinary()` looks here first; if
the platform-specific binary isn't present it falls back to a `whisper` /
`whisper-cpp` / `whisper-cli` on the user's PATH, then to manual lyric input.

## Layout

```
resources/whisper/
├── bin/
│   ├── darwin-arm64/whisper-cli       (Apple Silicon Mac)
│   ├── darwin-x64/whisper-cli         (Intel Mac)
│   ├── linux-x64/whisper-cli          (Linux x86_64)
│   └── win32-x64/whisper-cli.exe      (Windows x86_64)
└── models/
    ├── ggml-base.bin                  (~150 MB, recommended default)
    └── ggml-tiny.bin                  (~75 MB, fastest)
```

The detector picks `ggml-base.bin` first, then `ggml-tiny.bin`. Other model
files (small, medium, large) are not loaded by default.

## Why this is empty in the repo

Binary blobs are not committed to git. They are fetched / built at release
time. Two options:

1. **Build script** (`scripts/fetch-whisper.sh`, future): downloads pre-built
   whisper.cpp binaries from the upstream releases page + the ggml model
   from huggingface, places them here, and CI runs this before `dist:<os>`.
2. **Manual fetch**: contributor / packager runs `make` against a checkout
   of whisper.cpp for each target OS and drops the resulting `whisper-cli`
   here.

Until binaries land, the runtime falls back gracefully — see fallback chain
above.

## Licensing

- whisper.cpp: MIT (https://github.com/ggerganov/whisper.cpp/blob/master/LICENSE)
- ggml-* models: MIT (https://huggingface.co/ggerganov/whisper.cpp)

Both are bundle-friendly. Attribution is in the app's About panel.

## Size impact

- `whisper-cli` binary per OS: ~3-8 MB
- `ggml-base.bin`: ~142 MB
- `ggml-tiny.bin`: ~75 MB

Choosing `ggml-base.bin` adds ~150 MB to the installer; users can swap to
`ggml-tiny.bin` (~75 MB) for a smaller package or higher speed.
