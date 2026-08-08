/* Electron adapter for opening a validated absolute file path. */
import { shell } from 'electron';
import type { FileOpener } from '@megumi/product/host';

export const electronFileOpenAdapter: FileOpener = {
  openPath: async (absolutePath) => {
    const message = await shell.openPath(absolutePath);
    return message ? { status: 'failed', message } : { status: 'opened' };
  },
};
