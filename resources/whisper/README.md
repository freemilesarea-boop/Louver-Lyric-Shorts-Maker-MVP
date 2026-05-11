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
time by `scripts/fetch-whisper.sh`:

- **Windows**: downloads the upstream `whisper-bin-x64.zip` from the
  pinned whisper.cpp GitHub release and extracts `whisper-cli.exe`.
- **macOS / Linux**: clones the same release tag and builds `whisper-cli`
  from source via cmake (takes ~2-3 minutes on a CI runner).
- **ggml model**: pulled from Hugging Face (`ggml-base.bin` by default;
  set `WHISPER_MODEL=tiny` in the environment for a smaller bundle).

The script is idempotent — re-running it skips downloads when the binary
and model already exist. CI invokes it before `electron-builder` packages
the installer (see `.github/workflows/build-release.yml → Fetch bundled
whisper`). Local devs can also run it directly:

```sh
scripts/fetch-whisper.sh                          # auto-detect host OS
WHISPER_MODEL=tiny scripts/fetch-whisper.sh       # smaller bundle
FORCE_PLATFORM=darwin-arm64 scripts/fetch-whisper.sh   # cross-fetch
```

Pin a different upstream version with `WHISPER_RELEASE=v1.x.y` (default:
`v1.7.4`).

If the fetch fails (offline runner, upstream outage), the runtime still
falls back gracefully — see fallback chain above. The in-app
TranscribeButton surfaces a friendly Korean message.

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
