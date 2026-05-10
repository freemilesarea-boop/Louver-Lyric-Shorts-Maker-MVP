/**
 * Demo Render Pack — generates 20+ sample MP4s under `output/demo-pack/`
 * using the real shared modules (shared/scene.ts, animation, motion,
 * audioReactive, cinematicFx). Each combo exercises a different vibe so
 * the resulting videos can be eyeballed as a "moodboard" of the app.
 *
 * Run with:
 *   node --experimental-strip-types scripts/demo-render-pack.ts
 *
 * No external assets required — backdrops and audio are synthesized via
 * ffmpeg lavfi sources. Lyrics are built-in vibe-keyed snippets.
 *
 * Headless canvas: the renderer's overlay generator normally relies on
 * `document.createElement('canvas')`. We swap that for `@napi-rs/canvas`
 * in this script and pipe the resulting buffer directly to disk.
 */

import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';

import {
  ANIMATION_KEYFRAME_FPS,
  ENTER_SEC,
  EXIT_SEC,
  REST_STATE,
  animationStateAt,
  isStaticAnimation,
  planKeyframes,
} from '../src/shared/animation.ts';
import {
  buildAmplitudeCurve,
  reactiveStateAt,
} from '../src/shared/audioReactive.ts';
import {
  fxConfigForPreset,
} from '../src/shared/cinematicFx.ts';
import {
  ffmpegMotionExpressions,
  isStaticMotion,
} from '../src/shared/motion.ts';
import { renderScene, SCENE_W, SCENE_H } from '../src/shared/scene.ts';
import { templates } from '../src/renderer/templates/templates.ts';
import type {
  AnimationPreset,
  FxPreset,
  LanguageCode,
  LyricLine,
  MotionPreset,
  ReactiveMode,
  Template,
} from '../src/shared/types.ts';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static') as string;
const ffprobePath = (require('ffprobe-static') as { path: string }).path;

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(REPO_ROOT, 'output', 'demo-pack');

/* ---------------------------------------------------------------- combos */

type BackdropId = 'pink' | 'purple' | 'cyan' | 'sepia' | 'gray' | 'red' | 'green';
type AudioProfile = 'calm' | 'building' | 'beat';
type LyricSetId = 'kballad' | 'rnb' | 'drive' | 'love' | 'indie' | 'pop' | 'minimal';

interface DemoCombo {
  id: string;
  templateId: string;
  motion: MotionPreset;
  animation: AnimationPreset;
  reactive: ReactiveMode;
  fx: FxPreset;
  backdrop: BackdropId;
  audio: AudioProfile;
  lang: LanguageCode;
  lyrics: LyricSetId;
  /** Per-demo override of clip duration. Default 12s for fast iteration. */
  durationSec?: number;
}

const DEMO_COMBOS: DemoCombo[] = [
  // 5 sample-preset bundles
  { id: 'kballad-emotional', templateId: 'soft-kpop-lyric', motion: 'float_soft', animation: 'soft_pop', reactive: 'lyric_glow', fx: 'soft_blur', backdrop: 'pink', audio: 'calm', lang: 'ko', lyrics: 'kballad' },
  { id: 'english-rnb-night', templateId: 'dark-music-player', motion: 'float_soft', animation: 'blur_fade', reactive: 'cinematic_bloom', fx: 'subtle_bloom', backdrop: 'purple', audio: 'calm', lang: 'en', lyrics: 'rnb' },
  { id: 'neon-drive-pop', templateId: 'neon-drive', motion: 'slow_zoom_in', animation: 'karaoke_glow', reactive: 'neon_pulse', fx: 'bloom_neon', backdrop: 'cyan', audio: 'beat', lang: 'en', lyrics: 'drive' },
  { id: 'polaroid-love-song', templateId: 'polaroid-mood', motion: 'slow_zoom_out', animation: 'slide_down', reactive: 'soft_pulse', fx: 'dust_grain', backdrop: 'sepia', audio: 'calm', lang: 'en', lyrics: 'love' },
  { id: 'vhs-indie-mood', templateId: 'vhs-night', motion: 'pan_right', animation: 'blur_fade', reactive: 'cinematic_bloom', fx: 'aberration_grain', backdrop: 'purple', audio: 'building', lang: 'en', lyrics: 'indie' },
  // 15 mood/template variants
  { id: 'minimal-clean', templateId: 'minimal-white', motion: 'slow_zoom_in', animation: 'fade', reactive: 'soft_pulse', fx: 'clean_cinematic', backdrop: 'gray', audio: 'calm', lang: 'en', lyrics: 'minimal' },
  { id: 'minimal-still', templateId: 'minimal-white', motion: 'none', animation: 'fade', reactive: 'none', fx: 'clean_cinematic', backdrop: 'gray', audio: 'calm', lang: 'en', lyrics: 'minimal' },
  { id: 'dark-rnb-pulse', templateId: 'dark-music-player', motion: 'slow_zoom_in', animation: 'fade', reactive: 'cinematic_bloom', fx: 'subtle_bloom', backdrop: 'purple', audio: 'beat', lang: 'en', lyrics: 'rnb' },
  { id: 'spotify-pop-rise', templateId: 'spotify-inspired', motion: 'slow_zoom_in', animation: 'slide_up', reactive: 'waveform_boost', fx: 'subtle_bloom', backdrop: 'green', audio: 'beat', lang: 'en', lyrics: 'pop' },
  { id: 'spotify-pop-quiet', templateId: 'spotify-inspired', motion: 'float_soft', animation: 'fade', reactive: 'cinematic_bloom', fx: 'subtle_bloom', backdrop: 'green', audio: 'calm', lang: 'en', lyrics: 'minimal' },
  { id: 'apple-bold-pan', templateId: 'apple-music-inspired', motion: 'pan_left', animation: 'fade', reactive: 'cinematic_bloom', fx: 'soft_blur', backdrop: 'red', audio: 'calm', lang: 'en', lyrics: 'pop' },
  { id: 'youtube-circle-pop', templateId: 'youtube-music-inspired', motion: 'float_soft', animation: 'soft_pop', reactive: 'soft_pulse', fx: 'clean_cinematic', backdrop: 'red', audio: 'beat', lang: 'en', lyrics: 'pop' },
  { id: 'cassette-warm', templateId: 'cassette-tape', motion: 'pan_right', animation: 'soft_pop', reactive: 'waveform_boost', fx: 'film_texture', backdrop: 'sepia', audio: 'building', lang: 'en', lyrics: 'love' },
  { id: 'cassette-classic', templateId: 'cassette-tape', motion: 'slow_zoom_out', animation: 'slide_down', reactive: 'waveform_boost', fx: 'film_texture', backdrop: 'sepia', audio: 'building', lang: 'en', lyrics: 'love' },
  { id: 'softkpop-glow-fade', templateId: 'soft-kpop-lyric', motion: 'float_soft', animation: 'fade', reactive: 'lyric_glow', fx: 'soft_blur', backdrop: 'pink', audio: 'calm', lang: 'ko', lyrics: 'kballad' },
  { id: 'neon-zoom-pop', templateId: 'neon-drive', motion: 'slow_zoom_in', animation: 'soft_pop', reactive: 'neon_pulse', fx: 'bloom_neon', backdrop: 'cyan', audio: 'beat', lang: 'en', lyrics: 'drive' },
  { id: 'vhs-pan-blur', templateId: 'vhs-night', motion: 'pan_left', animation: 'blur_fade', reactive: 'cinematic_bloom', fx: 'aberration_grain', backdrop: 'purple', audio: 'building', lang: 'en', lyrics: 'indie' },
  { id: 'polaroid-zoom-soft', templateId: 'polaroid-mood', motion: 'slow_zoom_in', animation: 'soft_pop', reactive: 'soft_pulse', fx: 'dust_grain', backdrop: 'sepia', audio: 'calm', lang: 'en', lyrics: 'love' },
  { id: 'dark-rnb-float', templateId: 'dark-music-player', motion: 'float_soft', animation: 'blur_fade', reactive: 'cinematic_bloom', fx: 'subtle_bloom', backdrop: 'purple', audio: 'beat', lang: 'en', lyrics: 'rnb' },
  { id: 'neon-float-glow', templateId: 'neon-drive', motion: 'float_soft', animation: 'karaoke_glow', reactive: 'neon_pulse', fx: 'bloom_neon', backdrop: 'cyan', audio: 'beat', lang: 'en', lyrics: 'drive' },
];

// Two lines per mood keeps each demo's overlay-PNG budget small enough that
// ffmpeg's filter graph stays fast. Production renders can use any number
// of lines — see src/renderer/lib/overlays.ts (MAX_OVERLAY_PNGS).
const LYRIC_SETS: Record<LyricSetId, LyricLine[]> = {
  kballad: [
    { text: 'Slow rain falling down', ko: '느리게 내리는 비' },
    { text: 'I still remember you', ko: '아직 너를 기억해' },
  ],
  rnb: [
    { text: 'Whisper your name tonight' },
    { text: 'Soft fading lights', ko: '흐려지는 너' },
  ],
  drive: [
    { text: 'CITY LIGHTS FLICKER ON' },
    { text: 'DRIVE INTO THE NIGHT' },
  ],
  love: [
    { text: 'Polaroid memories of you' },
    { text: 'First snow of the year', ko: '첫눈 같은 너' },
  ],
  indie: [
    { text: 'Faded summer night drives' },
    { text: 'Echoes of you and me' },
  ],
  pop: [
    { text: 'Hold me closer tonight' },
    { text: 'Dance till the morning sun' },
  ],
  minimal: [
    { text: 'Just breathe' },
    { text: 'Be here now' },
  ],
};

const BACKDROP_LAVFI: Record<BackdropId, string> = {
  pink:   'gradients=size=1080x1920:c0=0xff9bbe:c1=0x6d2342:duration=1',
  purple: 'gradients=size=1080x1920:c0=0x1a0033:c1=0x6b0080:duration=1',
  cyan:   'gradients=size=1080x1920:c0=0x00305a:c1=0x00ffd1:duration=1',
  sepia:  'gradients=size=1080x1920:c0=0x301810:c1=0xc89868:duration=1',
  gray:   'gradients=size=1080x1920:c0=0xf2f2f2:c1=0xa8a8a8:duration=1',
  red:    'gradients=size=1080x1920:c0=0x300000:c1=0xff2d55:duration=1',
  green:  'gradients=size=1080x1920:c0=0x031b0a:c1=0x1db954:duration=1',
};

const AUDIO_LAVFI: Record<AudioProfile, (sec: number) => string> = {
  calm: (sec) => `sine=frequency=220:duration=${sec}`,
  building: (sec) =>
    `aevalsrc=sin(2*PI*220*t)*if(lt(t\\,${sec * 0.3})\\,0.2\\,if(lt(t\\,${sec * 0.7})\\,0.5\\,0.9)):duration=${sec}`,
  beat: (sec) =>
    `aevalsrc=sin(2*PI*220*t)*(0.25+0.55*max(0\\,sin(2*PI*1.8*t))):duration=${sec}`,
};

/* ---------------------------------------------- ffmpeg helpers (synthetic IO) */

function runFfmpegSync(args: string[]): { ok: boolean; stderr: string } {
  const r = spawnSync(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  return { ok: r.status === 0, stderr: r.stderr?.toString() ?? '' };
}

async function generateBackdrop(id: BackdropId, outPath: string): Promise<void> {
  await fs.mkdir(dirname(outPath), { recursive: true });
  const r = runFfmpegSync([
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', BACKDROP_LAVFI[id],
    '-frames:v', '1', '-update', '1', outPath,
  ]);
  if (!r.ok) throw new Error(`backdrop ${id}: ${r.stderr.slice(-400)}`);
}

async function generateAudio(profile: AudioProfile, sec: number, outPath: string): Promise<void> {
  await fs.mkdir(dirname(outPath), { recursive: true });
  const r = runFfmpegSync([
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', AUDIO_LAVFI[profile](sec),
    outPath,
  ]);
  if (!r.ok) throw new Error(`audio ${profile}: ${r.stderr.slice(-400)}`);
}

async function loadAmpCurve(audioPath: string, sec: number) {
  const PCM_RATE = 8000;
  const r = spawnSync(ffmpegPath, [
    '-loglevel', 'error', '-i', audioPath,
    '-vn', '-ac', '1', '-ar', String(PCM_RATE),
    '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1',
  ]);
  if (r.status !== 0) throw new Error(`PCM extract failed`);
  const buf = r.stdout as Buffer;
  const aligned = buf.byteLength - (buf.byteLength % 4);
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, aligned / 4);
  return buildAmplitudeCurve(f32, PCM_RATE, sec, 0.05);
}

/* ---------------------------------------------- canvas-overlay rendering */

// Demo pack runs use a tighter overlay budget than production so the 20+
// renders finish in minutes, not an hour. Production keeps the full
// MAX_OVERLAY_PNGS = 120 cap (see src/renderer/lib/overlays.ts).
const DEMO_MAX_OVERLAY_PNGS = 18;
const DEMO_KEYFRAME_FPS = 6;
function effectiveKeyframeFps(animationPreset: AnimationPreset, chunkCount: number): number {
  if (isStaticAnimation(animationPreset) || chunkCount === 0) return DEMO_KEYFRAME_FPS;
  const perChunk =
    Math.ceil(ENTER_SEC * DEMO_KEYFRAME_FPS) +
    1 +
    Math.ceil(EXIT_SEC * DEMO_KEYFRAME_FPS);
  const projected = perChunk * chunkCount;
  if (projected <= DEMO_MAX_OVERLAY_PNGS) return DEMO_KEYFRAME_FPS;
  return Math.max(2, Math.round((DEMO_KEYFRAME_FPS * DEMO_MAX_OVERLAY_PNGS) / projected * 10) / 10);
}

interface OverlayKeyframe {
  pngPath: string;
  startSec: number;
  endSec: number;
}

async function renderOverlayKeyframes(args: {
  combo: DemoCombo;
  template: Template;
  durationSec: number;
  ampCurve: ReturnType<typeof buildAmplitudeCurve>;
  tempDir: string;
  photoImg: Image;
}): Promise<OverlayKeyframe[]> {
  const { combo, template, durationSec, ampCurve, tempDir } = args;
  const lines = LYRIC_SETS[combo.lyrics];
  const slice = durationSec / Math.max(1, lines.length);
  const chunks = lines.map((line, i) => ({
    line, start: i * slice, end: (i + 1) * slice,
  }));
  const fxConfig = fxConfigForPreset(combo.fx);
  const keyframeFps = effectiveKeyframeFps(combo.animation, chunks.length);

  const out: OverlayKeyframe[] = [];
  let ix = 0;
  for (const chunk of chunks) {
    const dur = chunk.end - chunk.start;
    for (const slot of planKeyframes(combo.animation, dur, keyframeFps)) {
      const animState = isStaticAnimation(combo.animation)
        ? REST_STATE
        : animationStateAt(combo.animation, dur, slot.sampleSec);
      if (animState.opacity <= 0.02) continue;
      const tClip = chunk.start + slot.sampleSec;
      const reactive = reactiveStateAt(combo.reactive, ampCurve, tClip);
      const fxSeed = Math.round(tClip * 1000) | 0;

      const canvas = createCanvas(SCENE_W, SCENE_H);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, SCENE_W, SCENE_H);
      renderScene(ctx as unknown as CanvasRenderingContext2D, {
        width: SCENE_W,
        height: SCENE_H,
        template,
        language: combo.lang,
        highlightSub: true,
        exportMode: true,
        lyric: chunk.line,
        animation: animState,
        reactive,
        fxConfig,
        fxSeed,
      });
      const pngPath = join(tempDir, `ov_${ix.toString().padStart(3, '0')}.png`);
      await fs.writeFile(pngPath, canvas.toBuffer('image/png'));
      out.push({
        pngPath,
        startSec: chunk.start + slot.windowStart,
        endSec: chunk.start + slot.windowEnd,
      });
      ix++;
    }
  }
  return out;
}

/* ---------------------------------------------- ffmpeg filter graph (mirror of main/render/filters.ts) */

function colorWithAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const cleaned = hex.startsWith('#') ? hex.slice(1) : hex;
  return `0x${cleaned}@${a.toFixed(3)}`;
}

function bgEffectChain(effect: Template['backgroundEffect']): string {
  switch (effect) {
    case 'blur': return 'boxblur=20:5,eq=brightness=-0.05:saturation=1.05';
    case 'darken': return 'boxblur=8:3,eq=brightness=-0.25:saturation=0.95';
    case 'sepia': return 'boxblur=12:3,eq=brightness=-0.05:saturation=0.6,colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131';
    case 'none':
    default: return 'boxblur=4:2';
  }
}

function buildFilterGraphLocal(args: {
  W: number; H: number; fps: number; durationSec: number;
  template: Template; overlays: { inputIndex: number; startSec: number; endSec: number }[];
  motionPreset: MotionPreset;
}): string {
  const { W, H, fps, durationSec, template: t, overlays, motionPreset } = args;
  const lines: string[] = [];
  lines.push(`[0:v]split=2[src1][src2]`);
  lines.push(
    `[src1]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
    `crop=${W}:${H},${bgEffectChain(t.backgroundEffect)}[bg]`,
  );
  const cardW = Math.round(W * 0.86);
  const cardH = Math.round(H * 0.62);
  if (isStaticMotion(motionPreset)) {
    lines.push(`[src2]scale=${cardW}:${cardH}:force_original_aspect_ratio=decrease[fg]`);
  } else {
    const m = ffmpegMotionExpressions(motionPreset, durationSec, fps);
    lines.push(
      `[src2]scale=${cardW}:${cardH}:force_original_aspect_ratio=increase,crop=${cardW}:${cardH},` +
      `zoompan=z='${m.zExpr}':x='${m.xExpr}':y='${m.yExpr}':d=1:s=${cardW}x${cardH}:fps=${fps}[fg]`,
    );
  }
  lines.push(`[bg][fg]overlay=(W-w)/2:(H-h)/2-80[stage0]`);
  let chainIn = 'stage0';
  if (t.overlayOpacity > 0) {
    lines.push(
      `[${chainIn}]drawbox=x=0:y=0:w=${W}:h=${H}:` +
      `color=${colorWithAlpha(t.cardBg, t.overlayOpacity * 0.25)}:t=fill[stage1]`,
    );
    chainIn = 'stage1';
  }
  overlays.forEach((ov, idx) => {
    const out = `ov${idx}`;
    lines.push(
      `[${chainIn}][${ov.inputIndex}:v]overlay=0:0:` +
      `enable='between(t,${ov.startSec.toFixed(3)},${ov.endSec.toFixed(3)})'[${out}]`,
    );
    chainIn = out;
  });
  if (t.progressBarStyle !== 'none') {
    const margin = 80;
    const barY = Math.round(H * 0.88);
    const fullW = W - margin * 2;
    const barH = t.progressBarStyle === 'thick' ? 10 : 6;
    lines.push(
      `[${chainIn}]drawbox=x=${margin}:y=${barY}:w=${fullW}:h=${barH}:` +
      `color=${colorWithAlpha(t.lyricColor, 0.25)}:t=fill[track]`,
    );
    lines.push(
      `[track]drawbox=x=${margin}:y=${barY}:` +
      `w='min(${fullW},${fullW}*t/${durationSec})':h=${barH}:` +
      `color=${colorWithAlpha(t.lyricColor, 0.95)}:t=fill:replace=1[bar]`,
    );
    chainIn = 'bar';
  }
  lines.push(`[${chainIn}]format=yuv420p,fps=${fps}[vout]`);
  return lines.join(';\n');
}

/* ---------------------------------------------- per-combo render */

interface RenderReport {
  id: string;
  ok: boolean;
  error?: string;
  bakeMs: number;
  ffmpegMs: number;
  totalMs: number;
  sizeBytes: number;
  keyframes: number;
  outputPath: string;
}

async function renderOne(combo: DemoCombo): Promise<RenderReport> {
  const t0 = Date.now();
  const template = templates.find((x) => x.id === combo.templateId) ?? templates[0];
  const durationSec = combo.durationSec ?? 6;
  const tempDir = await mkdtemp(join(tmpdir(), `demo-${combo.id}-`));
  const outputPath = join(OUT_DIR, `demo_${combo.id}.mp4`);

  try {
    // 1. Build assets.
    const photoPath = join(tempDir, 'backdrop.png');
    await generateBackdrop(combo.backdrop, photoPath);
    const audioPath = join(tempDir, 'audio.wav');
    await generateAudio(combo.audio, durationSec, audioPath);
    const ampCurve = await loadAmpCurve(audioPath, durationSec);
    const photoImg = await loadImage(photoPath);

    // 2. Bake overlay keyframes via shared scene renderer + headless canvas.
    const bakeStart = Date.now();
    const keyframes = await renderOverlayKeyframes({
      combo, template, durationSec, ampCurve, tempDir, photoImg,
    });
    const bakeMs = Date.now() - bakeStart;

    // 3. Build filter graph + run ffmpeg.
    const overlays = keyframes.map((k, i) => ({
      inputIndex: 2 + i,
      startSec: Math.max(0, k.startSec),
      endSec: Math.min(durationSec, k.endSec),
    }));
    const filter = buildFilterGraphLocal({
      W: SCENE_W, H: SCENE_H, fps: 30, durationSec, template, overlays, motionPreset: combo.motion,
    });
    const filterFile = join(tempDir, 'filter.txt');
    await fs.writeFile(filterFile, filter, 'utf8');

    const args: string[] = ['-y', '-loglevel', 'error'];
    args.push('-loop', '1', '-framerate', '30', '-i', photoPath);
    args.push('-ss', '0', '-t', String(durationSec), '-i', audioPath);
    for (const k of keyframes) {
      args.push('-loop', '1', '-framerate', '30', '-i', k.pngPath);
    }
    args.push('-filter_complex_script', filterFile);
    args.push('-map', '[vout]', '-map', '1:a');
    args.push('-r', '30', '-t', String(durationSec));
    // ultrafast keeps the demo pack snappy; quality is more than enough to
    // eyeball motion + animation + reactive + FX. Production renders use
    // -preset medium -crf 20 (see src/main/render/pipeline.ts).
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23');
    args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart');
    args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '44100');
    args.push('-shortest', outputPath);

    await fs.mkdir(OUT_DIR, { recursive: true });
    const ffmpegStart = Date.now();
    await runFfmpegAsync(args);
    const ffmpegMs = Date.now() - ffmpegStart;

    const stat = await fs.stat(outputPath);
    return {
      id: combo.id, ok: true,
      bakeMs, ffmpegMs, totalMs: Date.now() - t0,
      sizeBytes: stat.size, keyframes: keyframes.length, outputPath,
    };
  } catch (e) {
    return {
      id: combo.id, ok: false,
      error: e instanceof Error ? e.message : String(e),
      bakeMs: 0, ffmpegMs: 0, totalMs: Date.now() - t0,
      sizeBytes: 0, keyframes: 0, outputPath,
    };
  } finally {
    fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runFfmpegAsync(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

/* ---------------------------------------------- main */

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log(`[demo-pack] Output dir: ${OUT_DIR}`);
  console.log(`[demo-pack] Rendering ${DEMO_COMBOS.length} demos...`);
  console.log();

  const reports: RenderReport[] = [];
  for (let i = 0; i < DEMO_COMBOS.length; i++) {
    const combo = DEMO_COMBOS[i];
    process.stdout.write(`  [${(i + 1).toString().padStart(2)}/${DEMO_COMBOS.length}] ${combo.id.padEnd(28)} ... `);
    const r = await renderOne(combo);
    reports.push(r);
    if (r.ok) {
      console.log(
        `OK · ${r.keyframes.toString().padStart(3)}kf · bake ${r.bakeMs.toString().padStart(4)}ms ` +
        `· ffmpeg ${(r.ffmpegMs / 1000).toFixed(1).padStart(5)}s ` +
        `· ${(r.sizeBytes / 1024).toFixed(0).padStart(5)}KB`,
      );
    } else {
      console.log(`FAIL · ${r.error?.slice(0, 100)}`);
    }
  }

  // Probe one output for final QC.
  const firstOk = reports.find((r) => r.ok);
  if (firstOk) {
    const probe = spawnSync(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'stream=codec_name,width,height,r_frame_rate',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1',
      firstOk.outputPath,
    ]);
    console.log(`\nSample probe (${firstOk.id}):`);
    console.log(probe.stdout.toString().split('\n').map((l) => '  ' + l).join('\n'));
  }

  // Report.
  const ok = reports.filter((r) => r.ok);
  const fails = reports.filter((r) => !r.ok);
  const avgRender = ok.length ? ok.reduce((s, r) => s + r.totalMs, 0) / ok.length : 0;
  const avgSize = ok.length ? ok.reduce((s, r) => s + r.sizeBytes, 0) / ok.length : 0;
  const totalBytes = ok.reduce((s, r) => s + r.sizeBytes, 0);
  const totalRenderMs = reports.reduce((s, r) => s + r.totalMs, 0);

  console.log('\n=== Demo Render Pack Report ===');
  console.log(`  Generated:        ${ok.length} / ${reports.length}`);
  console.log(`  Failed:           ${fails.length}`);
  console.log(`  Avg render time:  ${(avgRender / 1000).toFixed(1)}s`);
  console.log(`  Avg file size:    ${(avgSize / 1024).toFixed(0)} KB`);
  console.log(`  Total time:       ${(totalRenderMs / 1000).toFixed(1)}s`);
  console.log(`  Total disk used:  ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Output:           ${OUT_DIR}`);

  if (fails.length > 0) {
    console.log('\nFailures:');
    for (const f of fails) console.log(`  ${f.id}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
