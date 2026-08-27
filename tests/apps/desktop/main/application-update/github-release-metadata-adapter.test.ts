/*
 * Verifies untrusted GitHub release data is normalized before entering the update Module.
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  ApplicationUpdateOperationError,
  createGithubReleaseMetadataAdapter,
} from '@megumi/desktop/main/application-update/github-release-metadata-adapter';

describe('GitHub release metadata adapter', () => {
  it('returns a normalized newer stable release with complete Squirrel assets', async () => {
    const adapter = createGithubReleaseMetadataAdapter({
      fetch: fetchResponse({
        tag_name: 'v0.2.0',
        name: 'Megumi 0.2.0',
        body: '# Changes\n\n- [Fixed](https://example.com) update flow. <b>Safe</b>.',
        html_url: 'https://github.com/anwen0724/megumi/releases/tag/v0.2.0',
        draft: false,
        prerelease: false,
        assets: [
          { name: 'Megumi-0.2.0 Setup.exe' },
          { name: 'Megumi-0.2.0-full.nupkg' },
          { name: 'RELEASES' },
        ],
      }),
    });

    await expect(adapter.checkLatest('0.1.0')).resolves.toEqual({
      status: 'available',
      release: {
        version: '0.2.0',
        title: 'Megumi 0.2.0',
        notesSummary: 'Changes Fixed update flow. Safe.',
        releasePageUrl: 'https://github.com/anwen0724/megumi/releases/tag/v0.2.0',
      },
    });
  });

  it('treats the current release as up to date without exposing assets', async () => {
    const adapter = createGithubReleaseMetadataAdapter({
      fetch: fetchResponse({
        tag_name: 'v0.1.0',
        name: 'Current',
        body: '',
        html_url: 'https://github.com/anwen0724/megumi/releases/tag/v0.1.0',
        draft: false,
        prerelease: false,
        assets: [
          { name: 'Megumi-0.1.0 Setup.exe' },
          { name: 'Megumi-0.1.0-full.nupkg' },
          { name: 'RELEASES' },
        ],
      }),
    });
    await expect(adapter.checkLatest('0.1.0')).resolves.toEqual({ status: 'up_to_date' });
  });

  it('rejects an otherwise valid release when one Squirrel asset class is missing', async () => {
    const adapter = createGithubReleaseMetadataAdapter({
      fetch: fetchResponse({
        tag_name: 'v0.2.0',
        name: 'Incomplete',
        body: '',
        html_url: 'https://github.com/anwen0724/megumi/releases/tag/v0.2.0',
        draft: false,
        prerelease: false,
        assets: [{ name: 'Megumi-0.2.0 Setup.exe' }, { name: 'RELEASES' }],
      }),
    });

    await expect(adapter.checkLatest('0.1.0')).rejects.toMatchObject<ApplicationUpdateOperationError>({
      code: 'release_assets_incomplete',
    });
  });

  it('rejects prerelease and off-repository release URLs at the boundary', async () => {
    const adapter = createGithubReleaseMetadataAdapter({
      fetch: fetchResponse({
        tag_name: 'v0.2.0',
        name: 'Invalid',
        body: '',
        html_url: 'https://example.com/release',
        draft: false,
        prerelease: true,
        assets: [],
      }),
    });

    await expect(adapter.checkLatest('0.1.0')).rejects.toMatchObject<ApplicationUpdateOperationError>({
      code: 'release_metadata_invalid',
    });
  });
});

function fetchResponse(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  }));
}
