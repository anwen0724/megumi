/* Verifies Discovery Settings defaults, normalization, validation, and persistence. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createSettings,
  type SettingsStore,
} from '../../../packages/agent/settings/src';

describe('Discovery Settings', () => {
  it('resolves the product defaults for old settings files', () => {
    const settings = createSettings({ store: memoryStore() });
    expect(settings.resolve()).toMatchObject({
      status: 'ok',
      settings: {
        discovery: {
          conversation_recognition_enabled: false,
          daily_generation_time: '08:00',
          daily_target_count: 20,
          enabled_sources: ['bilibili', 'open_web'],
        },
      },
    });
  });

  it('normalizes source IDs, persists the patch, and reads it after restart', () => {
    const store = memoryStore();
    const first = createSettings({ store });
    expect(first.update({
      patch: {
        discovery: {
          conversation_recognition_enabled: true,
          daily_generation_time: '21:35',
          daily_target_count: 37,
          enabled_sources: [' bilibili ', 'open_web', 'bilibili'],
        },
      },
    })).toMatchObject({ status: 'updated' });
    expect(store.document).toMatchObject({
      discovery: {
        conversation_recognition_enabled: true,
        daily_generation_time: '21:35',
        daily_target_count: 37,
        enabled_sources: ['bilibili', 'open_web'],
      },
    });

    expect(createSettings({ store }).resolve()).toMatchObject({
      status: 'ok',
      settings: { discovery: store.document.discovery },
    });
  });

  it.each([
    { daily_generation_time: '8:00' },
    { daily_generation_time: '24:00' },
    { daily_generation_time: '12:60' },
    { daily_target_count: 0 },
    { daily_target_count: 101 },
    { daily_target_count: 1.5 },
    { enabled_sources: [''] },
    { enabled_sources: ['   '] },
  ])('rejects an invalid Discovery patch: %j', (discovery) => {
    const store = memoryStore();
    const settings = createSettings({ store });
    expect(settings.update({ patch: { discovery } } as never)).toMatchObject({
      status: 'failed',
      failure: { details: { settings_code: 'settings_patch_invalid' } },
    });
    expect(store.document).toEqual({});
  });
});

function memoryStore(initial: unknown = {}) {
  const store: SettingsStore & { document: any } = {
    document: structuredClone(initial),
    read: () => structuredClone(store.document),
    write(next) {
      store.document = structuredClone(next);
    },
  };
  return store;
}
