/* Verifies discovery provider credentials and Twitter budgets stay behind Settings' secret boundary. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createSettings, type SettingsStore } from '../../../packages/agent/settings/src';

class MemorySettingsStore implements SettingsStore {
  constructor(public document: unknown = {}) {}
  read(): unknown { return structuredClone(this.document); }
  write(next: Readonly<Record<string, unknown>>): void { this.document = structuredClone(next); }
}

describe('discovery source settings', () => {
  it('stores provider credentials only in the secret-bearing file model', () => {
    const store = new MemorySettingsStore();
    const settings = createSettings({ store });

    expect(settings.writeDiscoverySourceCredential({ source_id: 'zhihu', credential: 'zhihu-secret' }))
      .toEqual({ status: 'updated' });
    expect(settings.writeDiscoverySourceCredential({ source_id: 'twitter', credential: 'twitter-secret' }))
      .toEqual({ status: 'updated' });
    expect(settings.getDiscoverySourceCredentialStatus({ source_id: 'zhihu' }))
      .toEqual({ status: 'ok', configured: true });
    expect(settings.readDiscoverySourceCredential({ source_id: 'twitter' }))
      .toEqual({ status: 'found', credential: 'twitter-secret' });
    expect(JSON.stringify(settings.read())).not.toMatch(/zhihu-secret|twitter-secret/);
    expect(JSON.stringify(settings.resolve())).not.toMatch(/zhihu-secret|twitter-secret/);
    expect(JSON.stringify(settings.getDiscoverySourceCredentialStatus({ source_id: 'twitter' })))
      .not.toContain('twitter-secret');

    expect(settings.deleteDiscoverySourceCredential({ source_id: 'twitter' })).toEqual({ status: 'deleted' });
    expect(settings.getDiscoverySourceCredentialStatus({ source_id: 'twitter' }))
      .toEqual({ status: 'ok', configured: false });
  });

  it('resolves bounded Twitter attempt budgets without exposing credentials', () => {
    const settings = createSettings({ store: new MemorySettingsStore({
      discovery: {
        twitter: { credential: 'secret' },
        twitter_budget: {
          max_search_calls: 2,
          max_results_per_search: 8,
          max_results_per_attempt: 12,
        },
      },
    }) });
    expect(settings.resolve()).toMatchObject({ status: 'ok', settings: { discovery: {
      twitter_budget: { max_search_calls: 2, max_results_per_search: 8, max_results_per_attempt: 12 },
    } } });
    expect(JSON.stringify(settings.resolve())).not.toContain('secret');
  });
});
