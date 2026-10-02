/* Adapts Settings-owned Provider credentials to the AI CredentialStore seam. */

import type { Credential, CredentialStore } from '@megumi/ai';
import type { Settings } from './settings';

export function createSettingsCredentialStore(
  settings: Pick<
    Settings,
    | 'listProviders'
    | 'readProviderApiKey'
    | 'writeProviderApiKey'
    | 'deleteProviderApiKey'
  >,
): CredentialStore {
  const pendingMutations = new Map<string, Promise<unknown>>();

  function serializeMutation<T>(providerId: string, operation: () => Promise<T>): Promise<T> {
    const previous = pendingMutations.get(providerId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    pendingMutations.set(providerId, current);
    return current.finally(() => {
      if (pendingMutations.get(providerId) === current) pendingMutations.delete(providerId);
    });
  }

  return {
    async read(providerId) {
      return readProviderCredential(settings, providerId);
    },

    async list() {
      const result = settings.listProviders();
      if (result.status === 'failed') throw new Error(result.failure.message);
      return result.providers
        .filter((provider) => provider.has_api_key)
        .map((provider) => ({ providerId: provider.provider_id, type: 'api_key' as const }));
    },

    modify(providerId, change) {
      return serializeMutation(providerId, async () => {
        const current = await readProviderCredential(settings, providerId);
        const next = await change(current);
        if (!next) return current;
        if (next.type !== 'api_key' || !next.key) {
          throw new Error('Settings only supports Provider API-key credentials with a key.');
        }
        const result = settings.writeProviderApiKey({
          provider_id: providerId,
          api_key: next.key,
        });
        if (result.status === 'failed') throw new Error(result.failure.message);
        return next;
      });
    },

    async delete(providerId) {
      await serializeMutation(providerId, async () => {
        const result = settings.deleteProviderApiKey({ provider_id: providerId });
        if (result.status === 'failed') throw new Error(result.failure.message);
      });
    },
  };
}

async function readProviderCredential(
  settings: Pick<Settings, 'readProviderApiKey'>,
  providerId: string,
): Promise<Credential | undefined> {
  const result = settings.readProviderApiKey({ provider_id: providerId });
  if (result.status === 'failed') throw new Error(result.failure.message);
  return result.status === 'found'
    ? { type: 'api_key', key: result.api_key }
    : undefined;
}
