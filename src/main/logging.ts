import log from 'electron-log';
import { app } from 'electron';
import { join } from 'node:path';

/**
 * Phase 5-11 — application-wide logging.
 *
 * electron-log writes to:
 *   Linux:   ~/.config/Lyric Shorts Maker/logs/main.log
 *   macOS:   ~/Library/Logs/Lyric Shorts Maker/main.log
 *   Windows: %APPDATA%\Lyric Shorts Maker\logs\main.log
 *
 * Logs rotate at 4 MB and retain the last 3 files. The renderer is
 * forwarded through the bridge so console.* in the UI also lands on
 * disk — critical when a user reports "I clicked X and nothing
 * happened" because the renderer's DevTools console isn't open.
 *
 * Levels: `log.error()` for errors, `log.warn()` for soft failures,
 * `log.info()` for milestone events (transcribe started, render done),
 * `log.debug()` for verbose noise. The main-process console.* helpers
 * still go to stdout (for `npm run dev`) BUT now also flow into the
 * file via the transport hook below.
 */

export function configureLogging(): void {
  // File transport — rotates per file size.
  log.transports.file.maxSize = 4 * 1024 * 1024; // 4 MB
  log.transports.file.format = '{y}-{m}-{d} {h}:{i}:{s}.{ms} [{level}] {scope} {text}';
  log.transports.file.level = 'info';

  // Console transport — keep verbose during dev, milestone-only in
  // packaged builds so stdout doesn't get spammed.
  log.transports.console.level = app.isPackaged ? 'info' : 'debug';

  // Pipe every console.* call in the main process through electron-log
  // so file logs always include the boot-time and IPC logs that other
  // modules emit with plain console.log/error/warn. Without this, the
  // [whisper:selfcheck] / [transcode] / [video] lines never reach the
  // file, defeating the point of having a log we can ship.
  const orig = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  console.log = (...a: unknown[]) => {
    log.info(...a);
    orig.log(...a);
  };
  console.info = (...a: unknown[]) => {
    log.info(...a);
    orig.info(...a);
  };
  console.warn = (...a: unknown[]) => {
    log.warn(...a);
    orig.warn(...a);
  };
  console.error = (...a: unknown[]) => {
    log.error(...a);
    orig.error(...a);
  };
  console.debug = (...a: unknown[]) => {
    log.debug(...a);
    orig.debug(...a);
  };

  log.info('[app] version=' + app.getVersion() + ' packaged=' + app.isPackaged);
  log.info('[app] platform=' + process.platform + ' arch=' + process.arch);
  log.info('[app] node=' + process.versions.node + ' electron=' + process.versions.electron);
}

/** Absolute path of the rolling main log on this OS. */
export function mainLogPath(): string {
  return log.transports.file.getFile().path;
}

/** Directory containing all our log files (so the user can zip it). */
export function logDir(): string {
  return join(mainLogPath(), '..');
}

/**
 * Read the tail of the log file as a single string. Used by the
 * "Copy diagnostics" UI so the user can paste their last N KB of
 * activity into a bug report.
 */
export async function readLogTail(maxBytes = 200_000): Promise<string> {
  const fs = await import('node:fs/promises');
  const path = mainLogPath();
  try {
    const stat = await fs.stat(path);
    const fh = await fs.open(path, 'r');
    try {
      const start = Math.max(0, stat.size - maxBytes);
      const len = stat.size - start;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, start);
      return buf.toString('utf8');
    } finally {
      await fh.close();
    }
  } catch (e) {
    return `(could not read log at ${path}: ${e instanceof Error ? e.message : String(e)})`;
  }
}
