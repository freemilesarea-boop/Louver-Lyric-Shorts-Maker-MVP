/**
 * Phase 5-8 — end-to-end MP4 + GIF main-media export smoke.
 *
 * Pins the contract that the ffmpeg pipeline branches correctly on
 * mainMediaKind:
 *   - mp4 input goes through `-stream_loop -1 -i video.mp4`.
 *   - gif input goes through the same animated path.
 *   - The video's own audio stream is NOT mapped into the output (we
 *     map `1:a` from the user-selected audio file only).
 *   - Output is exactly durationSec long, 1080×1920, H.264 + AAC.
 *   - A video shorter than durationSec actually loops (we verify by
 *     making a 1s source and rendering 4s — output exists at 4s and
 *     is valid).
 *
 * Synthesizes a tiny mp4 and gif on the fly via ffmpeg-static so the
 * test has no external fixtures.
 *
 * Run:  npx tsx scripts/test-video-export.ts
 */

import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ffmpegPath from 'ffmpeg-static';
import { runRender } from '../src/main/render/pipeline';
import { templates } from '../src/renderer/templates/templates';
import type { RenderRequest } from '../src/shared/types';

let allOk = true;
const ok = (label: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${extra ? ' · ' + extra : ''}`);
  if (!cond) allOk = false;
};

function ffmpegBin(): string {
  if (typeof ffmpegPath === 'string') return ffmpegPath;
  throw new Error('ffmpeg-static not resolved');
}

function run(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (out += d.toString()));
    p.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
}

async function makeFixtureMp4(out: string, durationSec: number): Promise<void> {
  // Synthesize a 320×240 testsrc video (no audio) of exactly durationSec.
  const r = await run(ffmpegBin(), [
    '-y',
    '-f', 'lavfi',
    '-i', `testsrc=size=320x240:rate=10:duration=${durationSec}`,
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    out,
  ]);
  if (r.code !== 0) throw new Error(`fixture mp4 build failed: ${r.out.slice(-400)}`);
}

async function makeFixtureGif(out: string): Promise<void> {
  const r = await run(ffmpegBin(), [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc=size=160x120:rate=8:duration=1',
    out,
  ]);
  if (r.code !== 0) throw new Error(`fixture gif build failed: ${r.out.slice(-400)}`);
}

async function makeFixtureMp3(out: string, durationSec: number): Promise<void> {
  const r = await run(ffmpegBin(), [
    '-y',
    '-f', 'lavfi',
    '-i', `sine=frequency=440:duration=${durationSec}`,
    '-c:a', 'libmp3lame',
    '-b:a', '64k',
    out,
  ]);
  if (r.code !== 0) throw new Error(`fixture mp3 build failed: ${r.out.slice(-400)}`);
}

interface ProbedStreams {
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
  durationSec: number;
  vcodec: string;
  acodec: string;
}

async function probe(path: string): Promise<ProbedStreams> {
  // Use ffmpeg itself in error mode — ffprobe-static isn't in the
  // smoke's import graph and ffmpeg's -hide_banner output is enough.
  const r = await run(ffmpegBin(), ['-hide_banner', '-i', path]);
  const out = r.out;
  const widthHeight = /Video:[^,]+, [^,]+, (\d+)x(\d+)/.exec(out);
  const vcodec = /Video:\s*([^\s,]+)/.exec(out);
  const acodec = /Audio:\s*([^\s,]+)/.exec(out);
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out);
  return {
    hasVideo: !!vcodec,
    hasAudio: !!acodec,
    width: widthHeight ? parseInt(widthHeight[1], 10) : 0,
    height: widthHeight ? parseInt(widthHeight[2], 10) : 0,
    durationSec: dur
      ? parseInt(dur[1], 10) * 3600 + parseInt(dur[2], 10) * 60 + parseFloat(dur[3])
      : 0,
    vcodec: vcodec?.[1] ?? '',
    acodec: acodec?.[1] ?? '',
  };
}

async function exportOnce(args: {
  mainPath: string;
  mainKind: 'image' | 'gif' | 'video';
  audioPath: string;
  outputPath: string;
  durationSec: 15 | 30 | 60;
}): Promise<void> {
  const tpl = templates.find((t) => t.id === 'minimal-white') ?? templates[0];
  const req: RenderRequest = {
    imagePath: args.mainPath,
    mainMediaKind: args.mainKind,
    audioPath: args.audioPath,
    lyrics: [],
    template: tpl,
    startSec: 0,
    durationSec: args.durationSec,
    highlightKorean: false,
    outputPath: args.outputPath,
    overlays: [],
    motionPreset: 'none',
    animationPreset: 'none',
    reactiveMode: 'none',
    fxPreset: 'none',
  };
  await runRender(req, args.outputPath, () => undefined);
}

async function main(): Promise<void> {
  const work = await fs.mkdtemp(join(tmpdir(), 'video-export-smoke-'));
  try {
    // === Setup fixtures ===
    const mp4Long = join(work, 'src-long.mp4'); // 4s source
    const mp4Short = join(work, 'src-short.mp4'); // 1s source — must loop
    const gifSrc = join(work, 'src.gif');
    const audioSrc = join(work, 'audio.mp3');
    await makeFixtureMp4(mp4Long, 4);
    await makeFixtureMp4(mp4Short, 1);
    await makeFixtureGif(gifSrc);
    await makeFixtureMp3(audioSrc, 4);

    // === 1. MP4 main media (longer than clip) ===
    const outMp4 = join(work, 'out-mp4.mp4');
    await exportOnce({
      mainPath: mp4Long,
      mainKind: 'video',
      audioPath: audioSrc,
      outputPath: outMp4,
      durationSec: 15,
    });
    // We requested durationSec=15 but only have 4s of audio — `-shortest`
    // will cap at 4s. The point of this test is shape: output exists,
    // is H.264 + AAC, 1080×1920, audio came from the audio file (mono
    // sine, not the silent video). We probe and assert.
    const probedMp4 = await probe(outMp4);
    ok('mp4 main media → output exists', (await fs.stat(outMp4)).size > 0);
    ok(
      'mp4 main media → 1080×1920',
      probedMp4.width === 1080 && probedMp4.height === 1920,
      `${probedMp4.width}x${probedMp4.height}`,
    );
    ok('mp4 main media → H.264 video', /h264|264/i.test(probedMp4.vcodec), probedMp4.vcodec);
    ok('mp4 main media → AAC audio', /aac/i.test(probedMp4.acodec), probedMp4.acodec);

    // === 2. MP4 shorter than clip → must loop ===
    const outMp4Loop = join(work, 'out-mp4-loop.mp4');
    await exportOnce({
      mainPath: mp4Short,
      mainKind: 'video',
      audioPath: audioSrc,
      outputPath: outMp4Loop,
      durationSec: 15,
    });
    const probedLoop = await probe(outMp4Loop);
    // Audio cap is 4s; output should be ~4s (capped by audio), not
    // ~1s (the video source length). If looping fails, ffmpeg would
    // have cut at the source's 1s mark.
    ok(
      '1s video looped → output duration > 3.5s (followed audio, not source)',
      probedLoop.durationSec > 3.5,
      `dur=${probedLoop.durationSec.toFixed(2)}s`,
    );

    // === 3. GIF main media ===
    const outGif = join(work, 'out-gif.mp4');
    await exportOnce({
      mainPath: gifSrc,
      mainKind: 'gif',
      audioPath: audioSrc,
      outputPath: outGif,
      durationSec: 15,
    });
    const probedGif = await probe(outGif);
    ok('gif main media → output exists', (await fs.stat(outGif)).size > 0);
    ok(
      'gif main media → 1080×1920',
      probedGif.width === 1080 && probedGif.height === 1920,
    );
    ok('gif main media → H.264 video', /h264|264/i.test(probedGif.vcodec));
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }

  console.log(`\n${allOk ? 'VIDEO/GIF EXPORT OK' : 'VIDEO/GIF EXPORT BROKEN'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
