// Handles renderer settings bridge operations through desktop settings infrastructure.
import type { DesktopIpcContext } from './ipc-context';
import { unavailable } from './ipc-errors';

export async function handleSettingsOperation(operation: string, payload: unknown, context?: DesktopIpcContext): Promise<unknown> {
  if (operation === 'settings.get') {
    const runtime = requireRuntime(context, operation);
    return { settings: runtime.settingsStore.getResolvedSettings() };
  }
  if (operation === 'settings.update') {
    const runtime = requireRuntime(context, operation);
    return { settings: runtime.settingsStore.updateSettings(payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}) };
  }
  return undefined;
}

function requireRuntime(context: DesktopIpcContext | undefined, operation: string) {
  if (!context?.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
  return context.runtime;
}
