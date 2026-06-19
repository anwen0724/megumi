// Handles renderer settings bridge operations through desktop settings infrastructure.
import { toRendererSafeSettings } from '../infrastructure/app-settings-store';
import type { DesktopIpcContext } from './ipc-context';
import { unavailable } from './ipc-errors';

export async function handleSettingsOperation(operation: string, payload: unknown, context?: DesktopIpcContext): Promise<unknown> {
  if (operation === 'settings.get') {
    const runtime = requireRuntime(context, operation);
    const settings = runtime.settingsStore.getResolvedSettings();
    return { settings: toRendererSafeSettings(settings) };
  }
  if (operation === 'settings.update') {
    const runtime = requireRuntime(context, operation);
    const settings = runtime.settingsStore.updateSettings(payload && typeof payload === 'object' ? payload as Record<string, unknown> : {});
    return { settings: toRendererSafeSettings(settings) };
  }
  return undefined;
}

function requireRuntime(context: DesktopIpcContext | undefined, operation: string) {
  if (!context?.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
  return context.runtime;
}
