/*
 * Adapts Electron autoUpdater events and commands to the update Controller's narrow port.
 */
import { autoUpdater } from 'electron';
import type {
  ElectronAutoUpdaterAdapter,
  ElectronAutoUpdaterEvent,
} from './application-update-controller';

/** Creates the Squirrel-backed download and install Adapter. */
export function createElectronAutoUpdaterAdapter(): ElectronAutoUpdaterAdapter {
  return {
    setFeedUrl(url) {
      autoUpdater.setFeedURL({ url });
    },
    checkForUpdates() {
      autoUpdater.checkForUpdates();
    },
    quitAndInstall() {
      autoUpdater.quitAndInstall();
    },
    subscribe(listener) {
      const onError = (error: Error) => listener({ type: 'error', error });
      const onUpdateAvailable = () => listener({ type: 'update-available' });
      const onUpdateNotAvailable = () => listener({ type: 'update-not-available' });
      const onUpdateDownloaded = () => listener({ type: 'update-downloaded' });
      autoUpdater.on('error', onError);
      autoUpdater.on('update-available', onUpdateAvailable);
      autoUpdater.on('update-not-available', onUpdateNotAvailable);
      autoUpdater.on('update-downloaded', onUpdateDownloaded);
      return () => {
        autoUpdater.removeListener('error', onError);
        autoUpdater.removeListener('update-available', onUpdateAvailable);
        autoUpdater.removeListener('update-not-available', onUpdateNotAvailable);
        autoUpdater.removeListener('update-downloaded', onUpdateDownloaded);
      };
    },
  };
}

export type { ElectronAutoUpdaterEvent };
