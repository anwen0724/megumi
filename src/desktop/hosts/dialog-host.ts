// Wraps Electron dialog APIs used by desktop IPC handlers.
import type { BrowserWindow, OpenDialogOptions } from 'electron';
import { dialog } from 'electron';

export interface DialogHost {
  openProjectDirectory(owner?: BrowserWindow): Promise<string | undefined>;
}

export function createDialogHost(): DialogHost {
  return {
    async openProjectDirectory(owner) {
      const options: OpenDialogOptions = {
        properties: ['openDirectory'],
      };
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
      return result.canceled ? undefined : result.filePaths[0];
    },
  };
}
