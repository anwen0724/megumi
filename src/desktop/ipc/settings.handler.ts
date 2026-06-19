// Handles renderer settings bridge operations.
import { unavailable } from './ipc-errors';

export async function handleSettingsOperation(operation: string, payload: unknown): Promise<unknown> {
  if (operation === 'settings.get') throw unavailable(operation, 'src settings repository is not implemented in this plan');
  if (operation === 'settings.update') throw unavailable(operation, 'src settings repository is not implemented in this plan');
  return undefined;
}
