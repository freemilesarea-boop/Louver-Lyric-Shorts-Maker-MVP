# App icons (electron-builder)

electron-builder picks up icons from this directory automatically. Drop:

- `icon.png`  — 1024×1024 PNG (used for Linux AppImage + fallback)
- `icon.icns` — macOS icon (use `iconutil` to make from a 1024 .iconset)
- `icon.ico` — Windows ICO bundle (256×256 minimum, ideally multi-resolution)

If a file is missing for a target, electron-builder will fall back to its
default Electron logo for that platform — the app still ships, it just
looks generic.

The smoke / dev / typecheck flow does not require any icon files.
