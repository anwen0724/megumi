// Adapts Electron dialog APIs for Desktop Main composition.
import { dialog } from 'electron';

export interface DesktopDialogHost {
  chooseDirectory(): Promise<{
    canceled: boolean;
    filePaths: string[];
  }>;
}

export const electronDialogHost: DesktopDialogHost = {
  chooseDirectory() {
    return dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
  },
};
