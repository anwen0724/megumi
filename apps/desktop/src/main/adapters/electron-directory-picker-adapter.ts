// Adapts Electron dialog APIs for Desktop Main composition.
import { dialog } from 'electron';

export interface ElectronDirectoryPickerAdapter {
  chooseDirectory(): Promise<{
    canceled: boolean;
    filePaths: string[];
  }>;
}

export const electronDirectoryPickerAdapter: ElectronDirectoryPickerAdapter = {
  chooseDirectory() {
    return dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
  },
};
