// Handles Electron window commands requested by the renderer.
import type { DesktopIpcContext } from '../ipc-context';

export async function handleWindowOperation(operation: string, _payload: unknown, context: DesktopIpcContext): Promise<unknown> {
  const window = context.getMainWindow();
  if (!window) return undefined;
  if (operation === 'windowControls.minimize') window.minimize();
  if (operation === 'windowControls.toggleMaximize') {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  }
  if (operation === 'windowControls.close') window.close();
  return undefined;
}
