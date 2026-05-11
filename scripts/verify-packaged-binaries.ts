/**
 * Verify that the ffmpeg-static / ffprobe-static binaries inside an
 * electron-builder dist output match the host OS — i.e. that we ran
 * `npm install` on the same OS we're packaging for. ffmpeg-static
 * downloads its single binary at install time keyed on
 * process.platform, so a cross-build silently bundles the wrong-OS
 * binary; this script catches that before we ship.
 *
 * Walks `release/*-unpacked/` for ffmpeg + ffprobe, peeks the first 16
 * bytes, and compares against the magic numbers expected for the
 * runtime OS:
 *   - macOS:   Mach-O (cf fa ed fe / fe ed fa cf / ce fa ed fe / ca fe ba be)
 *   - Windows: PE (MZ stub at byte 0)
 *   - Linux:   ELF (\x7fELF)
 *
 * Run it after `npm run dist:<os>` — the GitHub Actions matrix workflow
 * runs it as a gating step before uploading artifacts.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';

type Platform = 'darwin' | 'win32' | 'linux';

interface MagicSpec {
  label: string;
  matches: (head: Buffer) => boolean;
}

const MAGIC: Record<Platform, MagicSpec> = {
  darwin: {
    label: 'Mach-O',
    matches: (h) => {
      if (h.length < 4) return false;
      const m32 = h.readUInt32LE(0);
      // Variants per Apple's loader.h:
      //   MH_MAGIC_64   feedfacf  (BE bytes: cf fa ed fe → LE u32 0xfeedfacf)
      //   MH_CIGAM_64   cffaedfe  (the byte-swapped sibling)
      //   MH_MAGIC      feedface
      //   MH_CIGAM      cefaedfe
      //   FAT_MAGIC     cafebabe  (universal binaries)
      //   FAT_CIGAM     bebafeca
      return [
        0xfeedfacf, 0xcffaedfe,
        0xfeedface, 0xcefaedfe,
        0xcafebabe, 0xbebafeca,
      ].includes(m32);
    },
  },
  win32: {
    label: 'PE',
    matches: (h) => h.length >= 2 && h[0] === 0x4d && h[1] === 0x5a, // 'MZ'
  },
  linux: {
    label: 'ELF',
    matches: (h) =>
      h.length >= 4 && h[0] === 0x7f && h[1] === 0x45 && h[2] === 0x4c && h[3] === 0x46,
  },
};

interface BinaryCheck {
  path: string;
  /** Whether this binary is *expected* to exist for the host platform.
   *  ffprobe-static ships per-platform binaries for ALL OSes inside its
   *  bin/ tree; we only check the host's. ffmpeg-static has a single
   *  binary at install time — that one is the one we care about. */
  required: boolean;
}

async function findBinariesToCheck(platform: Platform): Promise<BinaryCheck[]> {
  const ext = platform === 'win32' ? '.exe' : '';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const ffmpegName = `ffmpeg${ext}`;
  const ffprobeRel = join('bin', platform, arch, `ffprobe${ext}`);
  // Phase 5-7 — bundled whisper.cpp lands under
  // `Resources/whisper/bin/<plat-key>/whisper-cli[.exe]` via
  // electron-builder's extraResources rule. The plat-key matches what
  // detectWhisperBinary builds at runtime.
  const whisperPlatKey =
    platform === 'darwin'
      ? `darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
      : platform === 'win32'
        ? 'win32-x64'
        : 'linux-x64';
  const whisperName = platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';

  // electron-builder lays the unpacked tree under different names per
  // platform target — collect every plausible spot.
  const unpackedRoots = await collectUnpackedRoots();
  const checks: BinaryCheck[] = [];

  for (const root of unpackedRoots) {
    // ffmpeg-static is at <root>/.../ffmpeg-static/<ffmpegName>
    const ffmpegCandidates = [
      join(root, 'resources', 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', ffmpegName),
    ];
    for (const p of ffmpegCandidates) {
      if (await pathExists(p)) checks.push({ path: p, required: true });
    }

    // ffprobe-static is at <root>/.../ffprobe-static/bin/<platform>/<arch>/...
    const ffprobeCandidates = [
      join(root, 'resources', 'app.asar.unpacked', 'node_modules', 'ffprobe-static', ffprobeRel),
    ];
    for (const p of ffprobeCandidates) {
      if (await pathExists(p)) checks.push({ path: p, required: true });
    }

    // Bundled whisper-cli (extraResources path: resources/whisper → whisper).
    // Required when fetch-whisper.sh ran in CI; optional otherwise so the
    // verifier doesn't fail builds that intentionally ship without it.
    const whisperCandidates = [
      join(root, 'resources', 'whisper', 'bin', whisperPlatKey, whisperName),
    ];
    for (const p of whisperCandidates) {
      if (await pathExists(p)) checks.push({ path: p, required: false });
    }
  }
  return checks;
}

async function collectUnpackedRoots(): Promise<string[]> {
  // Common electron-builder output dir names per target.
  const candidates = [
    'release/linux-unpacked',
    'release/win-unpacked',
    'release/mac/Lyric Shorts Maker.app/Contents',
    'release/mac-arm64/Lyric Shorts Maker.app/Contents',
    'release/mac-universal/Lyric Shorts Maker.app/Contents',
  ];
  const found: string[] = [];
  for (const c of candidates) {
    if (await pathExists(c)) found.push(c);
  }
  return found;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readMagic(path: string): Promise<Buffer> {
  const fd = await fs.open(path, 'r');
  try {
    const buf = Buffer.alloc(16);
    await fd.read(buf, 0, 16, 0);
    return buf;
  } finally {
    await fd.close();
  }
}

async function main(): Promise<void> {
  const platform = process.platform as Platform;
  if (!(platform in MAGIC)) {
    console.error(`Unsupported platform: ${platform}`);
    process.exit(1);
  }
  const expected = MAGIC[platform];
  console.log(`Verifying packaged binaries match host platform: ${platform} (${expected.label})\n`);

  const checks = await findBinariesToCheck(platform);
  if (checks.length === 0) {
    console.error(
      'No packaged ffmpeg/ffprobe binaries found under release/. ' +
        'Run `npm run dist:<os>` before this script.',
    );
    process.exit(1);
  }

  let allOk = true;
  for (const { path } of checks) {
    const head = await readMagic(path);
    const ok = expected.matches(head);
    const hex = Array.from(head.slice(0, 4))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    console.log(
      `  ${ok ? 'OK ' : 'BAD'} ${path}\n      magic=${hex}  expected=${expected.label}`,
    );
    if (!ok) allOk = false;
  }

  console.log();
  if (allOk) {
    console.log(`ALL ${checks.length} BINARIES MATCH HOST PLATFORM`);
  } else {
    console.error(`SOME BINARIES DON'T MATCH HOST PLATFORM — likely a cross-build mistake`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
