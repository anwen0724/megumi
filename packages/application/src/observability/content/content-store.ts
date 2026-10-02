/*
 * Persists immutable captured bytes by SHA-256 through verified same-directory atomic moves.
 */
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { ObservabilityStorage } from '../persistence/observability-storage';

const CONTENT_ID_PATTERN = /^[a-f0-9]{64}$/;

export interface ContentStoreWriteInput {
  readonly contentId: string;
  readonly bytes: Uint8Array;
}

export type ContentStoreWriteResult =
  | { readonly status: 'stored' }
  | { readonly status: 'existing' }
  | { readonly status: 'failed' };

export type ContentStoreReadResult =
  | { readonly status: 'available'; readonly bytes: Uint8Array }
  | { readonly status: 'missing' }
  | { readonly status: 'corrupt' }
  | { readonly status: 'failed' };

export interface ContentStore {
  /** Persists verified bytes once or reports that the immutable blob already exists. */
  write(input: ContentStoreWriteInput): Promise<ContentStoreWriteResult>;
  /** Reads and verifies one content-addressed blob. */
  read(contentId: string): Promise<ContentStoreReadResult>;
}

export interface CreateContentStoreOptions {
  readonly rootDirectory: string;
  readonly storage: ObservabilityStorage;
  readonly createTempId?: () => string;
}

/** Creates an immutable Content Store under the fixed Observability content layout. */
export function createContentStore(options: CreateContentStoreOptions): ContentStore {
  const createTempId = options.createTempId ?? randomUUID;

  return {
    async write(input) {
      if (!isValidContent(input.contentId, input.bytes)) {
        return { status: 'failed' };
      }

      const destinationPath = contentPath(options.rootDirectory, input.contentId);
      const directoryPath = dirname(destinationPath);
      const temporaryPath = join(
        directoryPath,
        `.${input.contentId}.${createTempId()}.tmp`,
      );
      const existing = await inspectContent(
        options.storage,
        destinationPath,
        input.contentId,
      );
      if (existing === 'valid') {
        return { status: 'existing' };
      }
      if (existing !== 'missing') {
        return { status: 'failed' };
      }

      try {
        await options.storage.ensureDirectory(directoryPath);
        await options.storage.writeBytes(temporaryPath, input.bytes);
        const temporaryBytes = await options.storage.readBytes(temporaryPath);
        if (!isValidContent(input.contentId, temporaryBytes)) {
          await removeTemporaryFile(options.storage, temporaryPath);
          return { status: 'failed' };
        }
        await options.storage.move(temporaryPath, destinationPath);
        return { status: 'stored' };
      } catch {
        const racedDestination = await inspectContent(
          options.storage,
          destinationPath,
          input.contentId,
        );
        await removeTemporaryFile(options.storage, temporaryPath);
        return racedDestination === 'valid'
          ? { status: 'existing' }
          : { status: 'failed' };
      }
    },

    async read(contentId) {
      if (!CONTENT_ID_PATTERN.test(contentId)) {
        return { status: 'corrupt' };
      }
      const filePath = contentPath(options.rootDirectory, contentId);
      try {
        const file = await options.storage.stat(filePath);
        if (!file) {
          return { status: 'missing' };
        }
        if (file.kind !== 'file') {
          return { status: 'corrupt' };
        }
        const bytes = await options.storage.readBytes(filePath);
        return isValidContent(contentId, bytes)
          ? { status: 'available', bytes }
          : { status: 'corrupt' };
      } catch {
        return { status: 'failed' };
      }
    },
  };
}

type InspectedContent = 'missing' | 'valid' | 'invalid' | 'failed';

/** Distinguishes an absent blob from valid, corrupt, or unreadable persisted content. */
async function inspectContent(
  storage: ObservabilityStorage,
  filePath: string,
  contentId: string,
): Promise<InspectedContent> {
  try {
    const file = await storage.stat(filePath);
    if (!file) {
      return 'missing';
    }
    if (file.kind !== 'file') {
      return 'invalid';
    }
    const bytes = await storage.readBytes(filePath);
    return isValidContent(contentId, bytes) ? 'valid' : 'invalid';
  } catch {
    return 'failed';
  }
}

async function removeTemporaryFile(
  storage: ObservabilityStorage,
  temporaryPath: string,
): Promise<void> {
  try {
    await storage.removeFile(temporaryPath);
  } catch {
    // A stale temporary file is untrusted and is handled by startup maintenance.
  }
}

function contentPath(rootDirectory: string, contentId: string): string {
  return join(
    rootDirectory,
    'content',
    'sha256',
    contentId.slice(0, 2),
    `${contentId}.blob`,
  );
}

function isValidContent(contentId: string, bytes: Uint8Array): boolean {
  return CONTENT_ID_PATTERN.test(contentId) && hashBytes(bytes) === contentId;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
