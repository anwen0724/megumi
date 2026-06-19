// Wraps Electron shell APIs for desktop-only file opening.
import { shell } from 'electron';

export interface ShellHost {
  openPath(path: string): Promise<void>;
}

export function createShellHost(): ShellHost {
  return {
    async openPath(path) {
      const error = await shell.openPath(path);
      if (error) throw new Error(error);
    },
  };
}
