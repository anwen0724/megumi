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
          recommendation_generation_time: '08:00',
          recommendation_target_count: 20,
          recommendation_working_set_count: 80,
          enabled_sources: ['bilibili', 'open_web'],
          candidate_content_excerpt_max_characters: 8_000,
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
          recommendation_generation_time: '21:35',
          recommendation_target_count: 37,
          recommendation_working_set_count: 90,
          enabled_sources: [' bilibili ', 'open_web', 'bilibili'],
        },
      },
    })).toMatchObject({ status: 'updated' });
    expect(store.document).toMatchObject({
      discovery: {
        conversation_recognition_enabled: true,
        recommendation_generation_time: '21:35',
        recommendation_target_count: 37,
        recommendation_working_set_count: 90,
        enabled_sources: ['bilibili', 'open_web'],
      },
    });

    expect(createSettings({ store }).resolve()).toMatchObject({
      status: 'ok',
      settings: { discovery: store.document.discovery },
    });
  });

  it.each([
    { recommendation_generation_time: '8:00' },
    { recommendation_generation_time: '24:00' },
    { recommendation_generation_time: '12:60' },
    { recommendation_target_count: 0 },
    { recommendation_target_count: 101 },
    { recommendation_target_count: 1.5 },
    { recommendation_target_count: 81, recommendation_working_set_count: 80 },
    { recommendation_working_set_count: 201 },
    { candidate_content_excerpt_max_characters: 0 },
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
