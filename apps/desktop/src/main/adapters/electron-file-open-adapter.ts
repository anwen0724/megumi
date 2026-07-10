/* Electron adapter for opening a validated absolute file path. */
import { shell } from 'electron';
import type { FileOpenPort } from '@megumi/product/host-interface';

export const electronFileOpenAdapter: FileOpenPort = {
  openPath: async (absolutePath) => {
    const message = await shell.openPath(absolutePath);
    return message ? { status: 'failed', message } : { status: 'opened' };
  },
};
