// Exposes the migrated renderer bridge through Electron contextBridge.
import { contextBridge } from 'electron';
import { createMegumiRendererApi } from './megumi-api';

export function exposeMegumiApi(): void {
  contextBridge.exposeInMainWorld('megumi', createMegumiRendererApi());
}
