/**
 * Whisper language-hint comparison harness (Phase 5-9).
 *
 * Runs the production transcribe() against the same audio slice with
 * three different language hints and dumps a side-by-side report:
 *
 *   A) language='ko'  (force Korean)
 *   B) language='auto' (let whisper detect)
 *   C) language='en'  (force English)
 *
 * For each run we capture:
 *   - detected_language (whisper's own decision)
 *   - segment count
 *   - line count
 *   - avg confidence (avg_logprob) when available
 *   - first 200 chars of raw transcript
 *
 * Accuracy ranking is loose — we don't have ground truth here, but
 * (a) detected_language matching the forced value when forced,
 * (b) high avg_logprob, (c) low no_speech_prob, and (d) plausible
 * Korean Hangul / Latin character density are strong signals.
 *
 * Run:
 *   LSM_WHISPER_KEEP_WAV=1 npx tsx scripts/whisper-language-compare.ts /path/to/sample.mp3
 *
 * Or with a 10s clip range:
 *   npx tsx scripts/whisper-language-compare.ts /path/to/sample.mp3 0 10
 */

import { transcribe } from '../src/main/audio/transcribe';

interface RunReport {
  label: string;
  language: 'ko' | 'auto' | 'en';
  detected: string;
  segments: number;
  lines: number;
  hangulPercent: number;
  latinPercent: number;
  rawPreview: string;
  rawFull: string;
  ok: boolean;
  error?: string;
}

function charClassPercent(text: string, re: RegExp): number {
  const total = Array.from(text).length;
  if (total === 0) return 0;
  const hits = (text.match(re) ?? []).length;
  return Math.round((hits / total) * 1000) / 10;
}

async function runOne(
  audioPath: string,
  startSec: number,
  durationSec: number,
  language: 'ko' | 'auto' | 'en',
  label: string,
): Promise<RunReport> {
  // eslint-disable-next-line no-console
  console.log(`\n===== ${label} (language=${language}) =====`);
  try {
    const result = await transcribe({
      audioPath,
      startSec,
      durationSec,
      languageHint: language === 'auto' ? 'auto' : language,
    });
    const raw = result.rawText ?? '';
    return {
      label,
      language,
      detected: result.language,
      segments: result.lines.length, // segments and lines coincide here
      lines: result.lines.length,
      hangulPercent: charClassPercent(raw, /[가-힯]/g),
      latinPercent: charClassPercent(raw, /[A-Za-z]/g),
      rawPreview: raw.slice(0, 200),
      rawFull: raw,
      ok: true,
    };
  } catch (e) {
    return {
      label,
      language,
      detected: 'error',
      segments: 0,
      lines: 0,
      hangulPercent: 0,
      latinPercent: 0,
      rawPreview: '',
      rawFull: '',
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main(): Promise<void> {
  const [, , audioPath, startArg, durArg] = process.argv;
  if (!audioPath) {
    console.error(
      'Usage: tsx scripts/whisper-language-compare.ts <audio> [startSec=0] [durationSec=10]',
    );
    process.exit(2);
  }
  const startSec = parseFloat(startArg ?? '0') || 0;
  const durationSec = parseFloat(durArg ?? '10') || 10;

  console.log('== Whisper language-hint comparison ==');
  console.log('  audio:        ', audioPath);
  console.log('  window:       ', `${startSec}s + ${durationSec}s`);
  console.log('  (set LSM_WHISPER_KEEP_WAV=1 to also save the 16kHz mono wav)');

  const reports: RunReport[] = [];
  reports.push(await runOne(audioPath, startSec, durationSec, 'ko', 'A'));
  reports.push(await runOne(audioPath, startSec, durationSec, 'auto', 'B'));
  reports.push(await runOne(audioPath, startSec, durationSec, 'en', 'C'));

  console.log('\n========== Summary ==========');
  for (const r of reports) {
    if (!r.ok) {
      console.log(`  ${r.label} (lang=${r.language}) — FAILED: ${r.error?.slice(0, 200)}`);
      continue;
    }
    console.log(`\n  ${r.label} (language=${r.language})`);
    console.log(`    detected_language: ${r.detected}`);
    console.log(`    segments / lines:  ${r.segments} / ${r.lines}`);
    console.log(`    hangul % / latin %: ${r.hangulPercent}% / ${r.latinPercent}%`);
    console.log(`    preview: ${JSON.stringify(r.rawPreview)}`);
  }

  // Loose ranking — favors the run whose detected language matches its
  // forced value (when forced), whose output character mix matches that
  // language, and which produced more segments.
  console.log('\n========== Heuristic ranking ==========');
  const scored = reports
    .filter((r) => r.ok)
    .map((r) => {
      let score = 0;
      // forced-vs-detected alignment
      if (r.language === 'auto' || r.detected === r.language) score += 30;
      // expected character class for that forced language
      if (r.language === 'ko') score += r.hangulPercent;
      if (r.language === 'en') score += r.latinPercent;
      if (r.language === 'auto') {
        score += Math.max(r.hangulPercent, r.latinPercent);
      }
      // more segments = more meaningful transcription
      score += Math.min(20, r.segments * 4);
      return { ...r, score };
    })
    .sort((a, b) => b.score - a.score);

  scored.forEach((r, i) => {
    console.log(
      `  ${i + 1}. ${r.label} (lang=${r.language}) score=${r.score.toFixed(1)} ` +
        `detected=${r.detected} hangul=${r.hangulPercent}% latin=${r.latinPercent}% segs=${r.segments}`,
    );
  });

  if (scored.length > 0) {
    console.log(`\nBest match for THIS clip: ${scored[0].label} (language=${scored[0].language})`);
    console.log('Tip: for Korean lyrics, A (language="ko") usually wins. If B (auto)');
    console.log('     wins consistently on your sample, the model is confident enough');
    console.log('     that the in-app default ("auto") is fine.');
  }
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
