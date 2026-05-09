import { IpcMain, BrowserWindow, app } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { runRender, cancelActiveRender, RenderCancelled } from '../render/pipeline';
import type { RenderRequest, RenderProgress, RenderResult } from '../../shared/types';

export function registerRenderHandlers(
  ipcMain: IpcMain,
  getWin: () => BrowserWindow | null,
): void {
  ipcMain.handle('render:start', async (_e, req: RenderRequest): Promise<RenderResult> => {
    const win = getWin();
    const jobId = `job_${Date.now()}`;

    const send = (p: RenderProgress) => {
      win?.webContents.send('render:progress', p);
    };

    try {
      send({ jobId, percent: 0, stage: 'preparing' });

      const outDir =
        req.outputPath && req.outputPath.length > 0
          ? req.outputPath
          : join(app.getPath('videos'), 'LyricShorts');
      await fs.mkdir(outDir, { recursive: true });

      const stamp = formatStamp(new Date());
      const outFile = join(outDir, `lyric_short_${stamp}.mp4`);

      const result = await runRender(req, outFile, (percent) => {
        send({ jobId, percent, stage: 'rendering' });
      });

      send({ jobId, percent: 100, stage: 'done', outputPath: result.outputPath });
      return { ok: true, outputPath: result.outputPath };
    } catch (err) {
      if (err instanceof RenderCancelled) {
        send({ jobId, percent: 0, stage: 'cancelled', message: err.message });
        return { ok: false, error: 'cancelled' };
      }
      const message = err instanceof Error ? err.message : String(err);
      send({ jobId, percent: 0, stage: 'error', message });
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('render:cancel', () => {
    return cancelActiveRender();
  });
}

function formatStamp(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '_' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}
