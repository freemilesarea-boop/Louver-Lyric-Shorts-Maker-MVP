import { autoUpdater } from 'electron-updater';
import { BrowserWindow, app } from 'electron';
import log from 'electron-log';

/**
 * Phase 5-11 — auto-updater scaffold.
 *
 * Wires electron-updater against the GitHub Releases feed declared in
 * package.json `build.publish`. When a new release is published with
 * the matching `latest.yml` / `latest-mac.yml` / `latest-linux.yml`
 * the user gets:
 *
 *   1. update-available  → renderer notification
 *   2. download-progress → renderer progress bar
 *   3. update-downloaded → "재시작해서 설치할까요?" modal
 *
 * Disabled in three cases so we never accidentally pop an update
 * modal during dev / CI / first-time setup:
 *
 *   · !app.isPackaged           — `npm run dev` etc.
 *   · LSM_DISABLE_UPDATER=1     — manual env override
 *   · build.publish not set     — no feed configured
 *
 * The first release after this commit MUST be tagged so the feed has
 * a baseline. Use a prerelease tag (v1.0.0-rc.1) to avoid auto-
 * delivering to non-beta users before we're confident.
 */

export interface UpdaterEvent {
  kind:
    | 'checking'
    | 'update-available'
    | 'update-not-available'
    | 'download-progress'
    | 'update-downloaded'
    | 'error';
  version?: string;
  releaseNotes?: string | null;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  error?: string;
}

export function isUpdaterEnabled(): boolean {
  if (!app.isPackaged) return false;
  if (process.env['LSM_DISABLE_UPDATER'] === '1') return false;
  // electron-updater reads the publish config from app-update.yml,
  // which electron-builder generates from package.json `build.publish`.
  // When publish isn't configured the feed lookup fails — we'd rather
  // never poll than poll-and-error every launch.
  try {
    return Boolean(autoUpdater.getFeedURL());
  } catch {
    return false;
  }
}

export function startAutoUpdater(getWin: () => BrowserWindow | null): void {
  if (!isUpdaterEnabled()) {
    log.info('[updater] disabled (dev / opt-out / no publish config)');
    return;
  }
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // We send our OWN restart-modal so the user can dismiss; never
  // surprise-restart while they're editing.
  autoUpdater.autoRunAppAfterInstall = true;

  const emit = (e: UpdaterEvent) => {
    log.info('[updater]', e.kind, e);
    const win = getWin();
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater:event', e);
    }
  };

  autoUpdater.on('checking-for-update', () => emit({ kind: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    emit({
      kind: 'update-available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
    }),
  );
  autoUpdater.on('update-not-available', (info) =>
    emit({ kind: 'update-not-available', version: info.version }),
  );
  autoUpdater.on('download-progress', (p) =>
    emit({
      kind: 'download-progress',
      percent: p.percent,
      bytesPerSecond: p.bytesPerSecond,
      transferred: p.transferred,
      total: p.total,
    }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    emit({
      kind: 'update-downloaded',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
    }),
  );
  autoUpdater.on('error', (err) =>
    emit({ kind: 'error', error: err?.message ?? String(err) }),
  );

  // First check ~5s after launch — let the renderer settle so the
  // modal doesn't fight the first paint.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => {
      log.warn('[updater] initial check failed:', e?.message);
    });
  }, 5000);
}

/** Renderer-triggered manual check (e.g. via Help → "업데이트 확인"). */
export async function manualCheckForUpdates(): Promise<UpdaterEvent> {
  if (!isUpdaterEnabled()) {
    return { kind: 'error', error: '업데이트 기능이 비활성화되어 있어요 (개발 모드 또는 미배포 빌드).' };
  }
  try {
    const r = await autoUpdater.checkForUpdates();
    if (!r) return { kind: 'update-not-available' };
    return {
      kind: 'update-available',
      version: r.updateInfo.version,
      releaseNotes:
        typeof r.updateInfo.releaseNotes === 'string' ? r.updateInfo.releaseNotes : null,
    };
  } catch (e) {
    return { kind: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

/** Renderer-triggered install (after the user accepts the modal). */
export function quitAndInstall(): void {
  if (!isUpdaterEnabled()) return;
  autoUpdater.quitAndInstall();
}
