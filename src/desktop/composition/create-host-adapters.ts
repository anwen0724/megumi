// Creates all Electron/Node host adapters used by desktop composition.
import { createClipboardHost, type ClipboardHost } from '../hosts/clipboard-host';
import { createDialogHost, type DialogHost } from '../hosts/dialog-host';
import { createEnvironmentHost, type EnvironmentHost } from '../hosts/environment-host';
import { createFileHost, type FileHost } from '../hosts/file-host';
import { createMegumiHomeHost, type MegumiHomeHost } from '../hosts/megumi-home-host';
import { createProcessHost, type ProcessHost } from '../hosts/process-host';
import { createSecureStorageHost, type SecureStorageHost } from '../hosts/secure-storage-host';
import { createShellHost, type ShellHost } from '../hosts/shell-host';

export interface DesktopHostAdapters {
  clipboardHost: ClipboardHost;
  dialogHost: DialogHost;
  environmentHost: EnvironmentHost;
  fileHost: FileHost;
  megumiHomeHost: MegumiHomeHost;
  processHost: ProcessHost;
  secureStorageHost: SecureStorageHost;
  shellHost: ShellHost;
}

export function createHostAdapters(): DesktopHostAdapters {
  return {
    clipboardHost: createClipboardHost(),
    dialogHost: createDialogHost(),
    environmentHost: createEnvironmentHost(),
    fileHost: createFileHost(),
    megumiHomeHost: createMegumiHomeHost(),
    processHost: createProcessHost(),
    secureStorageHost: createSecureStorageHost(),
    shellHost: createShellHost(),
  };
}
