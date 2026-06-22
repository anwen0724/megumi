// Adapts Electron shell APIs for Desktop Main services that need OS handoff.
import { shell } from 'electron';

export interface DesktopShellHost {
  openPath(absolutePath: string): Promise<string>;
}

export const electronShellHost: DesktopShellHost = {
  openPath(absolutePath) {
    return shell.openPath(absolutePath);
  },
};
