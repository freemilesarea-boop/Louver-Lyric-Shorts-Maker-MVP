/**
 * Whisper bundle detection smoke.
 *
 * Phase 5-1 wired transcribe.ts to look at
 * `resources/whisper/bin/<platform>/whisper-cli` BEFORE falling back to
 * the system PATH. This test drops a fake whisper-cli (a tiny shell
 * script that exits 0 on --help) into the expected location and
 * verifies detectWhisperBinary picks it up.
 *
 * Also verifies bundledWhisperModelPath() finds a model file when
 * present, and that everything falls through to the PATH path when
 * neither bundled binary nor PATH whisper is installed.
 *
 * Run with:  npx tsx scripts/test-whisper-bundle.ts
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let allOk = true;
const ok = (label: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${extra ? ' · ' + extra : ''}`);
  if (!cond) allOk = false;
};

const platformKey = (() => {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  }
  if (process.platform === 'win32') return 'win32-x64';
  if (process.platform === 'linux') return 'linux-x64';
  return null;
})();

if (!platformKey) {
  console.error('Unsupported platform for whisper bundle:', process.platform);
  process.exit(2);
}

async function main(): Promise<void> {
  // Use a temp workspace as the cwd surrogate for bundledWhisperPath
  // dev-mode lookup. transcribe.ts in dev mode reads from
  // process.cwd() + 'resources/whisper'. We change cwd for the test.
  const work = await fs.mkdtemp(join(tmpdir(), 'whisper-bundle-smoke-'));
  const resourcesDir = join(work, 'resources', 'whisper');
  const binDir = join(resourcesDir, 'bin', platformKey);
  const modelsDir = join(resourcesDir, 'models');
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(modelsDir, { recursive: true });

  const binName =
    process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const binPath = join(binDir, binName);

  // ---- Sub-test 1: WITHOUT bundled binary, detect should return null
  //                 regardless of PATH. Phase 5-10 removed PATH
  //                 fallback entirely.
  const savedCwd = process.cwd();
  const savedPath = process.env.PATH;
  process.chdir(work);
  // Intentionally keep PATH populated this time — we want to assert
  // that a system whisper on PATH is NO LONGER picked up after the
  // Phase 5-10 bundled-only switch.
  try {
    const mod = await import('../src/main/audio/transcribe.ts');
    const r1 = mod.detectWhisperBinary(true);
    ok('no bundled + PATH whisper → detect STILL returns null (no PATH fallback)',
      r1 === null, `got=${JSON.stringify(r1)}`);
    ok('no model bundled → bundledWhisperModelPath returns null',
      mod.bundledWhisperModelPath() === null);

    // Self-check shape — Phase 5-10. With no bundled artifacts at
    // all, selfCheck.ok must be false and reason must name the
    // missing binary.
    const sc0 = mod.detectWhisperSelfCheck(true);
    ok('selfCheck.ok === false when no bundled', sc0.ok === false,
      `reason=${sc0.reason}`);
    ok('selfCheck.binFound === false', sc0.binFound === false);
    ok('selfCheck.modelFound === false', sc0.modelFound === false);
    ok('selfCheck.reason mentions 실행 파일',
      /실행 파일/.test(sc0.reason),
      `reason=${sc0.reason}`);

    // Set PATH to /nonexistent for the rest of the sub-tests to
    // confirm PATH continues to be ignored even when intentionally
    // cleared.
    process.env.PATH = '/nonexistent-rc-qa-path';

    // ---- Sub-test 2: drop a fake bundled whisper-cli. It must accept
    //                  `--help` with exit 0 for detectWhisperBinary to
    //                  pick it up (the existing probeBinary check).
    //                  Use a hard-coded shebang to /bin/sh so the
    //                  cleared PATH doesn't break the shebang's env
    //                  lookup. Restore PATH so other sub-tests aren't
    //                  affected (bundled detect runs BEFORE PATH path
    //                  anyway, so it's the bundled path that matters
    //                  here regardless of PATH).
    process.env.PATH = savedPath;
    const fakeScript =
      process.platform === 'win32'
        ? '@echo off\r\nexit /b 0\r\n'
        : '#!/bin/sh\nexit 0\n';
    await fs.writeFile(binPath, fakeScript);
    await fs.chmod(binPath, 0o755);

    const r2 = mod.detectWhisperBinary(true);
    ok(
      'bundled binary present → detect returns bundled',
      r2 !== null && r2.kind === 'whisper-cpp' && r2.bin === binPath,
      `got=${JSON.stringify(r2)}`,
    );

    // ---- Sub-test 3: drop a fake ggml-base.bin (just empty file —
    //                  the lookup only checks existsSync).
    const modelPath = join(modelsDir, 'ggml-base.bin');
    await fs.writeFile(modelPath, '');
    const m = mod.bundledWhisperModelPath();
    ok(
      'model bundled → bundledWhisperModelPath returns it',
      m === modelPath,
      `got=${m}`,
    );

    // ---- Sub-test 4: prefer ggml-base over ggml-tiny when both exist.
    const tinyPath = join(modelsDir, 'ggml-tiny.bin');
    await fs.writeFile(tinyPath, '');
    const m2 = mod.bundledWhisperModelPath();
    ok(
      'ggml-base preferred over ggml-tiny',
      m2 === modelPath,
      `got=${m2}`,
    );

    // ---- Sub-test 5: remove ggml-base, tiny is still picked up.
    await fs.rm(modelPath);
    const m3 = mod.bundledWhisperModelPath();
    ok(
      'ggml-tiny picked up when base absent',
      m3 === tinyPath,
      `got=${m3}`,
    );
  } finally {
    process.chdir(savedCwd);
    process.env.PATH = savedPath;
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }

  console.log(`\n${allOk ? 'WHISPER BUNDLE PLUMBING OK' : 'WHISPER BUNDLE BROKEN'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
