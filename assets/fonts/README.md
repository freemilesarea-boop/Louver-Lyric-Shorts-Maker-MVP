# Bundled fonts

`src/shared/fonts.ts` declares the font registry. To enable a registry
entry, drop the corresponding TTF/OTF file(s) into this directory using
the exact filenames listed below. They get bundled into the Electron
package via the `extraResources` rule in `package.json`.

Filenames are case-sensitive on macOS and Linux.

| FontKey | Filenames | License source |
| --- | --- | --- |
| `pretendard` | `Pretendard-Regular.ttf`, `Pretendard-Bold.ttf` | https://github.com/orioncactus/pretendard (SIL OFL) |
| `noto-sans-kr` | `NotoSansKR-Regular.ttf`, `NotoSansKR-Bold.ttf` | https://fonts.google.com/noto/specimen/Noto+Sans+KR (SIL OFL) |
| `inter` | `Inter-Regular.ttf`, `Inter-Bold.ttf` | https://github.com/rsms/inter (SIL OFL) |
| `sf-pro-display` | *(do not bundle — system-only on macOS)* | Apple system font |
| `caveat` | `Caveat-Bold.ttf` | https://fonts.google.com/specimen/Caveat (SIL OFL) |
| `orbitron` | `Orbitron-Bold.ttf` | https://fonts.google.com/specimen/Orbitron (SIL OFL) |
| `vt323` | `VT323-Regular.ttf` | https://fonts.google.com/specimen/VT323 (SIL OFL) |

If a file is missing the font picker still lists the entry — canvas falls
back to the per-font CSS fallback chain (system substitutes), and the
boot-time loader logs a warning to stderr but does not crash.

The architecture is described in `src/shared/fonts.ts` header comment —
search "Why we don't use ffmpeg drawtext" for the pipeline rationale.
