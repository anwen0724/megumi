// Handles provider settings without returning plaintext credentials.
import { unavailable } from './ipc-errors';

export async function handleProviderOperation(operation: string, payload: unknown): Promise<unknown> {
  if (operation === 'provider.list') throw unavailable(operation, 'src provider settings repository is not implemented in this plan');
  if (operation === 'provider.update') throw unavailable(operation, 'src provider settings repository is not implemented in this plan');
  if (operation === 'provider.setApiKey') throw unavailable(operation, 'src provider credential repository is not implemented in this plan');
  if (operation === 'provider.deleteApiKey') throw unavailable(operation, 'src provider credential repository is not implemented in this plan');
  return undefined;
}
