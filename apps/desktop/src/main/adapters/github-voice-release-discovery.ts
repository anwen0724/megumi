/* Discovers compatible, immutable Voice bundle manifests from project-owned GitHub Releases. */

import { net } from 'electron';
import { parseVoiceModelManifest, type VoiceModelReleaseDiscovery } from '@megumi/voice';

const RELEASES_URL = 'https://api.github.com/repos/anwen0724/megumi/releases?per_page=20';

interface JsonResponse {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

type FetchJson = (url: string, init?: { readonly headers?: Record<string, string> }) => Promise<JsonResponse>;

interface GithubRelease {
  readonly tag_name: string;
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly assets: readonly { readonly name: string; readonly browser_download_url: string }[];
}

export function createGithubVoiceReleaseDiscovery(
  options: { readonly fetch?: FetchJson } = {},
): VoiceModelReleaseDiscovery {
  const fetch = options.fetch ?? (net.fetch.bind(net) as unknown as FetchJson);
  return {
    async listManifests() {
      const response = await fetch(RELEASES_URL, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) throw new Error('Voice release discovery failed.');
      const releases = parseReleases(await response.json());
      const results = await Promise.allSettled(releases.map(async (release) => {
        const asset = release.assets.find((candidate) => candidate.name === 'voice-manifest.json');
        if (!asset) throw new Error(`Voice release ${release.tag_name} has no manifest.`);
        const manifestResponse = await fetch(asset.browser_download_url, {
          headers: { Accept: 'application/octet-stream' },
        });
        if (!manifestResponse.ok) throw new Error(`Voice release ${release.tag_name} manifest is unavailable.`);
        const manifest = parseVoiceModelManifest(await manifestResponse.json());
        if (manifest.bundleVersion !== release.tag_name) {
          throw new Error(`Voice release ${release.tag_name} manifest version does not match its tag.`);
        }
        return manifest;
      }));
      return results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    },
  };
}

function parseReleases(value: unknown): GithubRelease[] {
  if (!Array.isArray(value)) throw new Error('Voice release list is invalid.');
  return value.filter((candidate): candidate is GithubRelease => {
    if (!candidate || typeof candidate !== 'object') return false;
    const release = candidate as Partial<GithubRelease>;
    return typeof release.tag_name === 'string'
      && /^voice-v\d+$/.test(release.tag_name)
      && release.draft === false
      && release.prerelease === false
      && Array.isArray(release.assets);
  });
}
