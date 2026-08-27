/*
 * Validates GitHub's latest stable Release response and projects only update-safe metadata.
 */
import { z } from 'zod';
import type {
  ApplicationUpdateErrorCode,
  ApplicationUpdateRelease,
} from '../../application-update/application-update-contract';

const RELEASE_API_URL = 'https://api.github.com/repos/anwen0724/megumi/releases/latest';
const STABLE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const GithubReleaseSchema = z.object({
  tag_name: z.string(),
  name: z.unknown().optional(),
  body: z.unknown().optional(),
  html_url: z.string().url(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(z.object({ name: z.string() }).passthrough()),
}).passthrough();

interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type ApplicationReleaseCheckResult =
  | { readonly status: 'up_to_date' }
  | { readonly status: 'available'; readonly release: ApplicationUpdateRelease };

export interface GithubReleaseMetadataAdapter {
  /** Finds and validates a newer stable Release without starting a download. */
  checkLatest(currentVersion: string): Promise<ApplicationReleaseCheckResult>;
}

export class ApplicationUpdateOperationError extends Error {
  readonly code: ApplicationUpdateErrorCode;
  readonly retryable: boolean;

  constructor(code: ApplicationUpdateErrorCode, retryable: boolean, message: string) {
    super(message);
    this.name = 'ApplicationUpdateOperationError';
    this.code = code;
    this.retryable = retryable;
  }
}

/** Creates the GitHub boundary Adapter used only for update discovery. */
export function createGithubReleaseMetadataAdapter(options: {
  readonly fetch?: (url: string, init: Readonly<Record<string, unknown>>) => Promise<FetchResponse>;
} = {}): GithubReleaseMetadataAdapter {
  const fetchRelease = options.fetch ?? ((url, init) => fetch(url, init));
  return {
    async checkLatest(currentVersion) {
      const current = parseStableVersion(currentVersion);
      if (!current) {
        throw new ApplicationUpdateOperationError(
          'release_metadata_invalid',
          false,
          'The current application version is not a stable SemVer.',
        );
      }

      let response: FetchResponse;
      try {
        response = await fetchRelease(RELEASE_API_URL, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': `Megumi/${currentVersion}`,
          },
        });
      } catch {
        throw new ApplicationUpdateOperationError(
          'network_unavailable',
          true,
          'GitHub release metadata could not be reached.',
        );
      }
      if (response.status === 404) return { status: 'up_to_date' };
      if (!response.ok) {
        throw new ApplicationUpdateOperationError(
          'update_service_unavailable',
          true,
          `GitHub release metadata returned status ${response.status}.`,
        );
      }

      let rawRelease: unknown;
      try {
        rawRelease = await response.json();
      } catch {
        throw invalidMetadata('GitHub release metadata was not valid JSON.');
      }
      const parsed = GithubReleaseSchema.safeParse(rawRelease);
      if (!parsed.success || parsed.data.draft || parsed.data.prerelease) {
        throw invalidMetadata('GitHub latest release was not a public stable release.');
      }
      const version = parseStableTag(parsed.data.tag_name);
      if (!version || !isAllowedReleaseUrl(parsed.data.html_url, parsed.data.tag_name)) {
        throw invalidMetadata('GitHub release identity was invalid.');
      }
      if (compareVersion(version, current) <= 0) return { status: 'up_to_date' };
      assertCompleteSquirrelAssets(parsed.data.assets.map((asset) => asset.name));

      const notesSummary = toPlainTextSummary(
        typeof parsed.data.body === 'string' ? parsed.data.body : '',
      );
      return {
        status: 'available',
        release: {
          version: formatVersion(version),
          title: normalizedTitle(parsed.data.name, formatVersion(version)),
          ...(notesSummary ? { notesSummary } : {}),
          releasePageUrl: parsed.data.html_url,
        },
      };
    },
  };
}

type VersionTuple = readonly [major: number, minor: number, patch: number];

function parseStableVersion(version: string): VersionTuple | undefined {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function parseStableTag(tag: string): VersionTuple | undefined {
  const match = STABLE_TAG_PATTERN.exec(tag);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function compareVersion(left: VersionTuple, right: VersionTuple): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

function formatVersion(version: VersionTuple): string {
  return version.join('.');
}

function isAllowedReleaseUrl(url: string, tag: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:'
      && parsed.hostname === 'github.com'
      && parsed.pathname === `/anwen0724/megumi/releases/tag/${tag}`;
  } catch {
    return false;
  }
}

function assertCompleteSquirrelAssets(names: readonly string[]): void {
  const complete = names.includes('RELEASES')
    && names.some((name) => name.endsWith('-full.nupkg'))
    && names.some((name) => name.endsWith('.exe'));
  if (!complete) {
    throw new ApplicationUpdateOperationError(
      'release_assets_incomplete',
      true,
      'The stable Release does not contain a complete Squirrel.Windows asset set.',
    );
  }
}

function normalizedTitle(title: unknown, version: string): string {
  const normalized = typeof title === 'string' ? title.trim().slice(0, 160) : '';
  return normalized || `Megumi ${version}`;
}

// Remote Markdown is reduced to a bounded text summary before it can cross Preload.
function toPlainTextSummary(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[\s>#+*-]+/gm, '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim()
    .slice(0, 1_200);
}

function invalidMetadata(message: string): ApplicationUpdateOperationError {
  return new ApplicationUpdateOperationError('release_metadata_invalid', true, message);
}
