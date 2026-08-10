// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { createGithubVoiceReleaseDiscovery } from '@megumi/desktop/main/adapters/github-voice-release-discovery';

describe('GitHub Voice release discovery', () => {
  it('reads immutable voice release manifests and ignores drafts, prereleases, and malformed tags', async () => {
    const manifest = {
      version: 2,
      bundleVersion: 'voice-v2',
      runtimeVersion: 1,
      models: [{
        modelId: 'model', kind: 'stt', revision: 'r1', license: 'test', source: 'test',
        archive: { url: 'https://example.test/model.tar', size: 1, sha256: 'a', format: 'tar' },
        files: [{ path: 'model.bin', size: 1, sha256: 'b' }],
      }],
    };
    const fetch = vi.fn(async (url: string) => ({
      ok: true,
      async json() {
        if (url.includes('/releases?')) return [
          release('voice-v2', 'https://example.test/voice-v2.json'),
          { ...release('voice-v3', 'https://example.test/voice-v3.json'), draft: true },
          { ...release('voice-v4', 'https://example.test/voice-v4.json'), prerelease: true },
          release('other-v5', 'https://example.test/other.json'),
        ];
        return manifest;
      },
    }));
    const discovery = createGithubVoiceReleaseDiscovery({ fetch });

    await expect(discovery.listManifests()).resolves.toEqual([manifest]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

function release(tagName: string, manifestUrl: string) {
  return {
    tag_name: tagName,
    draft: false,
    prerelease: false,
    assets: [{ name: 'voice-manifest.json', browser_download_url: manifestUrl }],
  };
}
