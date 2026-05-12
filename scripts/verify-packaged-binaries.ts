/**
 * Verify that the ffmpeg-static / ffprobe-static binaries inside an
 * electron-builder dist output match the TARGET OS — i.e. that the
 * binaries packaged into win-unpacked/ are actually Windows .exe
 * files (and not Linux ELFs or Mach-O Mach binaries that snuck in
 * via a cross-build from the wrong host).
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
 *
 * Phase 5-11 stabilization: the target platform is inferred from the
 * directory name (`win-unpacked` → win32, `mac-unpacked` → darwin,
 * `linux-unpacked` → linux) instead of `process.platform`. This is
 * the cross-build foot-gun fix: running `npm run dist:win` on a
 * Linux host silently produces a `win-unpacked/` tree containing a
 * Linux ELF ffmpeg (since ffmpeg-static only downloads the host OS
 * binary at `npm install` time). Pre-fix the verifier passed because
 * it expected Linux binaries on a Linux host. Post-fix it checks
 * `win-unpacked → expects PE` and the wrong-arch binary is caught.
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

interface UnpackedRoot {
  path: string;
  /** Inferred from the directory name (win-unpacked → win32, etc.) */
  target: Platform;
}

async function findBinariesForTarget(
  root: UnpackedRoot,
): Promise<Array<BinaryCheck & { target: Platform }>> {
  const { path: dir, target } = root;
  const ext = target === 'win32' ? '.exe' : '';
  // ffmpeg-static lays one binary at the package root. ffprobe-static
  // ships per-platform under bin/<platform>/<arch>. Both should match
  // the TARGET we're packaging for.
  const arch = 'x64';
  const ffmpegName = `ffmpeg${ext}`;
  const ffprobeRel = join('bin', target, arch, `ffprobe${ext}`);
  const whisperPlatKey =
    target === 'darwin' ? `darwin-x64` : target === 'win32' ? 'win32-x64' : 'linux-x64';
  const whisperName = target === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';

  const out: Array<BinaryCheck & { target: Platform }> = [];
  const ffmpegDir = join(dir, 'resources', 'app.asar.unpacked', 'node_modules', 'ffmpeg-static');
  // Look for BOTH expected and wrong-extension names so we catch the
  // cross-build foot-gun: ffmpeg-static on Linux drops a binary
  // literally named `ffmpeg` (no .exe). When we package for win32
  // FROM a Linux host that file gets bundled as-is — ffmpeg.exe
  // never exists. The verifier used to look for ffmpeg.exe only, so
  // the wrong-arch ELF slipped through. Now we check whichever
  // `ffmpeg*` file actually exists, and the magic-byte check below
  // will reject it (Linux ELF in a win-unpacked tree → BAD).
  for (const name of [ffmpegName, 'ffmpeg', 'ffmpeg.exe']) {
    const p = join(ffmpegDir, name);
    if (await pathExists(p)) {
      out.push({ path: p, required: true, target });
      break;
    }
  }
  const ffprobePath = join(
    dir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'ffprobe-static',
    ffprobeRel,
  );
  if (await pathExists(ffprobePath)) {
    out.push({ path: ffprobePath, required: true, target });
  }
  const whisperPath = join(dir, 'resources', 'whisper', 'bin', whisperPlatKey, whisperName);
  if (await pathExists(whisperPath)) {
    out.push({ path: whisperPath, required: false, target });
  }
  return out;
}

async function collectUnpackedRoots(): Promise<UnpackedRoot[]> {
  // Common electron-builder output dir names per target.
  const candidates: UnpackedRoot[] = [
    { path: 'release/linux-unpacked', target: 'linux' },
    { path: 'release/win-unpacked', target: 'win32' },
    { path: 'release/mac/Lyric Shorts Maker.app/Contents', target: 'darwin' },
    { path: 'release/mac-arm64/Lyric Shorts Maker.app/Contents', target: 'darwin' },
    { path: 'release/mac-universal/Lyric Shorts Maker.app/Contents', target: 'darwin' },
  ];
  const found: UnpackedRoot[] = [];
  for (const c of candidates) {
    if (await pathExists(c.path)) found.push(c);
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
  const roots = await collectUnpackedRoots();
  if (roots.length === 0) {
    console.error(
      'No packaged tree found under release/. Run `npm run dist:<os>` before this script.',
    );
    process.exit(1);
  }

  console.log('Verifying packaged binaries match their TARGET platform.\n');
  console.log(`Host: ${process.platform}/${process.arch}`);
  console.log(`Targets found: ${roots.map((r) => r.target).join(', ')}\n`);

  let allOk = true;
  let totalChecked = 0;
  for (const root of roots) {
    const expected = MAGIC[root.target];
    const checks = await findBinariesForTarget(root);
    if (checks.length === 0) {
      console.warn(`  (no binaries under ${root.path} — skipping)`);
      continue;
    }
    console.log(`-- ${root.target} (${root.path}) ${'-'.repeat(40)}`);
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
      totalChecked++;
    }
  }

  console.log();
  if (allOk && totalChecked > 0) {
    console.log(`ALL ${totalChecked} BINARIES MATCH THEIR TARGET PLATFORM`);
  } else if (!allOk) {
    console.error(
      `SOME BINARIES DON'T MATCH THEIR TARGET PLATFORM — likely a cross-build mistake.\n` +
        `Cause: ffmpeg-static downloads only the HOST OS binary at \`npm install\` time.\n` +
        `Fix:   build the Windows installer on a Windows runner (CI matrix already does this),\n` +
        `       or rerun \`npm install\` on the target OS before \`npm run dist:<os>\`.`,
    );
    process.exit(1);
  } else {
    console.warn('No binaries checked. Was the dist step skipped?');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
