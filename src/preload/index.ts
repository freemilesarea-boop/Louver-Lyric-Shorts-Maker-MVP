import { contextBridge, ipcRenderer } from 'electron';
import type { LyricShortsAPI } from '../shared/api';
import type { RenderProgress, RenderRequest, RenderResult, AudioMeta } from '../shared/types';

const api: LyricShortsAPI = {
  pickImage: () => ipcRenderer.invoke('files:pickImage'),
  pickAudio: () => ipcRenderer.invoke('files:pickAudio'),
  pickOutputDir: () => ipcRenderer.invoke('files:pickOutputDir'),
  defaultOutputDir: () => ipcRenderer.invoke('files:defaultOutputDir'),
  probeAudio: (path: string): Promise<AudioMeta> => ipcRenderer.invoke('files:probeAudio', path),
  analyzeAmplitude: (path: string, startSec: number, durationSec: number) =>
    ipcRenderer.invoke('audio:analyzeAmplitude', path, startSec, durationSec),
  whisperAvailable: () => ipcRenderer.invoke('audio:whisperAvailable'),
  transcribe: (req) => ipcRenderer.invoke('audio:transcribe', req),
  cancelTranscribe: () => ipcRenderer.invoke('audio:cancelTranscribe'),
  readAsDataURL: (path: string) => ipcRenderer.invoke('files:readAsDataURL', path),
  fileExists: (path: string) => ipcRenderer.invoke('files:exists', path),
  basename: (path: string) => ipcRenderer.invoke('files:basename', path),

  startRender: (req: RenderRequest): Promise<RenderResult> =>
    ipcRenderer.invoke('render:start', req),
  cancelRender: () => ipcRenderer.invoke('render:cancel'),

  onRenderProgress: (cb: (p: RenderProgress) => void) => {
    const listener = (_e: unknown, p: RenderProgress) => cb(p);
    ipcRenderer.on('render:progress', listener);
    return () => ipcRenderer.removeListener('render:progress', listener);
  },

  openPath: (path: string) => ipcRenderer.invoke('app:openPath', path),
  showItemInFolder: (path: string) => ipcRenderer.invoke('app:showItemInFolder', path),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
};

contextBridge.exposeInMainWorld('lyric', api);
