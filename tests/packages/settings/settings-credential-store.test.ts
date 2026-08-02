// @vitest-environment node
/* Verifies that Settings adapts persisted Provider secrets to AI without exposing them to Product. */

import {
  createSettings,
  createSettingsCredentialStore,
  type SettingsStore,
} from '@megumi/settings';
import { describe, expect, it } from 'vitest';

describe('Settings CredentialStore Adapter', () => {
  it('owns Provider credential reads, writes, metadata listing, and deletion', async () => {
    const store = memoryStore();
    const credentials = createSettingsCredentialStore(createSettings({ store }));

    await credentials.modify('deepseek', async (current) => {
      expect(current).toBeUndefined();
      return { type: 'api_key', key: 'first-secret' };
    });

    await expect(credentials.read('deepseek')).resolves.toEqual({
      type: 'api_key',
      key: 'first-secret',
    });
    await expect(credentials.list()).resolves.toContainEqual({
      providerId: 'deepseek',
      type: 'api_key',
    });

    await credentials.modify('deepseek', async (current) => {
      expect(current).toEqual({ type: 'api_key', key: 'first-secret' });
      return { type: 'api_key', key: 'second-secret' };
    });
    await expect(credentials.read('deepseek')).resolves.toEqual({
      type: 'api_key',
      key: 'second-secret',
    });

    await credentials.delete('deepseek');
    await expect(credentials.read('deepseek')).resolves.toBeUndefined();
  });

  it('serializes concurrent mutations for the same Provider', async () => {
    const credentials = createSettingsCredentialStore(createSettings({ store: memoryStore() }));
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const calls: string[] = [];

    const first = credentials.modify('deepseek', async (current) => {
      calls.push('first');
      expect(current).toBeUndefined();
      markFirstStarted();
      await firstGate;
      return { type: 'api_key', key: 'first-secret' };
    });
    await firstStarted;
    const second = credentials.modify('deepseek', async (current) => {
      calls.push('second');
      expect(current).toEqual({ type: 'api_key', key: 'first-secret' });
      return { type: 'api_key', key: 'second-secret' };
    });

    await Promise.resolve();
    expect(calls).toEqual(['first']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(calls).toEqual(['first', 'second']);
    await expect(credentials.read('deepseek')).resolves.toEqual({
      type: 'api_key',
      key: 'second-secret',
    });
  });

  it('rejects Credential variants that Settings cannot persist', async () => {
    const credentials = createSettingsCredentialStore(createSettings({ store: memoryStore() }));

    await expect(credentials.modify('deepseek', async () => ({
      type: 'api_key',
      env: { ACCOUNT_ID: 'account' },
    }))).rejects.toThrow('Settings only supports Provider API-key credentials with a key.');
  });
});

function memoryStore(): SettingsStore {
  let value: Readonly<Record<string, unknown>> = {};
  return {
    read: () => value,
    write: (next) => {
      value = next;
    },
  };
}
