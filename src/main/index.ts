import { app, BrowserWindow, ipcMain, shell, protocol, net } from 'electron';
import { join } from 'node:path';
import { registerFileHandlers } from './ipc/files';
import { registerRenderHandlers } from './ipc/render';
import { mediaUrlToFileUrl } from './ipc/mediaUrl';

const isDev = !app.isPackaged;

// Phase 5-6.1: privileged `media://` scheme so the renderer can stream
// large gif / video / audio files via <img>/<video>/<audio> src without
// going through the V8-string-capped DataURL path. Must be declared
// BEFORE app.ready, hence at module top-level.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      bypassCSP: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#0a0a0c',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  // Stream local files for the renderer's <video>/<img>/<audio> elements.
  // net.fetch handles HTTP-style range requests so video scrubbing works.
  protocol.handle('media', (request) => {
    return net.fetch(mediaUrlToFileUrl(request.url));
  });

  registerFileHandlers(ipcMain, () => mainWindow);
  registerRenderHandlers(ipcMain, () => mainWindow);

  ipcMain.handle('app:openExternal', async (_e, url: string) => {
    await shell.openExternal(url);
  });
  ipcMain.handle('app:openPath', async (_e, p: string) => {
    return shell.openPath(p);
  });
  ipcMain.handle('app:showItemInFolder', (_e, p: string) => {
    shell.showItemInFolder(p);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
