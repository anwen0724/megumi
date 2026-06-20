// Handles provider settings without returning plaintext credentials.
import type { ProviderId } from '../../infrastructure/app-settings-store';
import type { DesktopIpcContext } from '../ipc-context';
import { unavailable } from '../ipc-errors';
import { unwrapRendererRuntimePayload } from '../runtime-request-payload';

export async function handleProviderOperation(operation: string, payload: unknown, context?: DesktopIpcContext): Promise<unknown> {
  const runtime = operation.startsWith('provider.') ? requireRuntime(context, operation) : undefined;
  if (operation === 'provider.list') return { providers: requireRuntime(context, operation).providerSettingsStore.listProviderStatuses() };
  if (operation === 'provider.update') {
    const runtime = requireRuntime(context, operation);
    const record = asRecord(unwrapRendererRuntimePayload(payload));
    const providerId = readProviderId(record);
    return { provider: runtime.providerSettingsStore.updateProviderSettings(providerId, {
      enabled: typeof record.enabled === 'boolean' ? record.enabled : undefined,
      displayName: typeof record.displayName === 'string' ? record.displayName : undefined,
      baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : undefined,
      defaultModelId: typeof record.defaultModelId === 'string' ? record.defaultModelId : undefined,
      apiKeyEnv: typeof record.apiKeyEnv === 'string' || record.apiKeyEnv === null ? record.apiKeyEnv : undefined,
    }) };
  }
  if (operation === 'provider.setApiKey') {
    const runtime = requireRuntime(context, operation);
    const record = asRecord(unwrapRendererRuntimePayload(payload));
    const providerId = readProviderId(record);
    const apiKey = typeof record.apiKey === 'string' ? record.apiKey : '';
    if (!apiKey.trim()) throw unavailable(operation, 'apiKey is required');
    return { provider: runtime.providerSettingsStore.setProviderApiKey(providerId, apiKey) };
  }
  if (operation === 'provider.deleteApiKey') {
    const runtime = requireRuntime(context, operation);
    const record = asRecord(unwrapRendererRuntimePayload(payload));
    return { provider: runtime.providerSettingsStore.deleteProviderApiKey(readProviderId(record)) };
  }
  return undefined;
}

function requireRuntime(context: DesktopIpcContext | undefined, operation: string) {
  if (!context?.runtime) throw unavailable(operation, 'desktop runtime services are not attached to IPC context');
  return context.runtime;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readProviderId(record: Record<string, unknown>): ProviderId {
  const value = record.providerId;
  if (value === 'deepseek' || value === 'openai' || value === 'anthropic') return value;
  throw unavailable('provider', 'providerId is required');
}
