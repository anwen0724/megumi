// @vitest-environment node
/* Verifies immutable, content-addressed persistence behind the diagnostic Content Store. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createContentStore } from '../../../packages/agent/observability/src/content/content-store';
import type {
  ObservabilityDirectoryEntry,
  ObservabilityFileStat,
  ObservabilityStorage,
} from '../../../packages/agent/observability/src/persistence/observability-storage';

const STORAGE_FAILURE_POINTS: readonly ('write' | 'move')[] = ['write', 'move'];

describe('Content Store', () => {
  it('verifies a temporary file, atomically moves it, and deduplicates equal content', async () => {
    const storage = new MemoryObservabilityStorage();
    const bytes = new TextEncoder().encode('captured prompt');
    const contentId = sha256(bytes);
    const store = createContentStore({
      rootDirectory: 'observability',
      storage,
      createTempId: () => 'temp-1',
    });

    await expect(store.write({ contentId, bytes })).resolves.toEqual({ status: 'stored' });
    await expect(store.write({ contentId, bytes })).resolves.toEqual({ status: 'existing' });

    expect(storage.operations.filter((operation) => operation.startsWith('write:'))).toHaveLength(1);
    expect(storage.operations.filter((operation) => operation.startsWith('move:'))).toHaveLength(1);
    expect(storage.filePaths()).toEqual([
      `observability\\content\\sha256\\${contentId.slice(0, 2)}\\${contentId}.blob`,
    ]);
    await expect(store.read(contentId)).resolves.toEqual({ status: 'available', bytes });
  });

  it('returns no stored reference and removes an unverified temporary file', async () => {
    const storage = new MemoryObservabilityStorage();
    storage.corruptNextWrite = true;
    const bytes = new TextEncoder().encode('content that must be verified');
    const contentId = sha256(bytes);
    const store = createContentStore({
      rootDirectory: 'observability',
      storage,
      createTempId: () => 'temp-corrupt',
    });

    await expect(store.write({ contentId, bytes })).resolves.toEqual({ status: 'failed' });

    expect(storage.filePaths()).toEqual([]);
    expect(storage.operations.some((operation) => operation.startsWith('move:'))).toBe(false);
    expect(storage.operations.some((operation) => operation.startsWith('remove:'))).toBe(true);
    await expect(store.read(contentId)).resolves.toEqual({ status: 'missing' });
  });

  it('rejects a mismatched identity before touching storage', async () => {
    const storage = new MemoryObservabilityStorage();
    const store = createContentStore({ rootDirectory: 'observability', storage });

    await expect(store.write({
      contentId: '0'.repeat(64),
      bytes: new TextEncoder().encode('different bytes'),
    })).resolves.toEqual({ status: 'failed' });

    expect(storage.operations).toEqual([]);
    expect(storage.filePaths()).toEqual([]);
  });

  it.each(STORAGE_FAILURE_POINTS)(
    'does not expose a stored reference when the host rejects %s',
    async (failurePoint) => {
      const storage = new MemoryObservabilityStorage();
      storage.failurePoint = failurePoint;
      const bytes = new TextEncoder().encode('diagnostic bytes');
      const contentId = sha256(bytes);
      const store = createContentStore({
        rootDirectory: 'observability',
        storage,
        createTempId: () => `temp-${failurePoint}`,
      });

      await expect(store.write({ contentId, bytes })).resolves.toEqual({ status: 'failed' });

      expect(storage.filePaths()).toEqual([]);
      await expect(store.read(contentId)).resolves.toEqual({ status: 'missing' });
    },
  );
});

class MemoryObservabilityStorage implements ObservabilityStorage {
  readonly operations: string[] = [];
  corruptNextWrite = false;
  failurePoint: 'write' | 'move' | undefined;
  private readonly files = new Map<string, Uint8Array>();

  async ensureDirectory(directoryPath: string): Promise<void> {
    this.operations.push(`directory:${directoryPath}`);
  }

  async appendText(filePath: string, content: string): Promise<void> {
    const existing = this.files.get(filePath) ?? new Uint8Array();
    const addition = new TextEncoder().encode(content);
    const combined = new Uint8Array(existing.byteLength + addition.byteLength);
    combined.set(existing);
    combined.set(addition, existing.byteLength);
    this.files.set(filePath, combined);
  }

  async readText(filePath: string): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(filePath));
  }

  async readBytes(filePath: string): Promise<Uint8Array> {
    const value = this.files.get(filePath);
    if (!value) {
      throw new Error('File not found.');
    }
    return new Uint8Array(value);
  }

  async writeBytes(filePath: string, bytes: Uint8Array): Promise<void> {
    this.operations.push(`write:${filePath}`);
    if (this.failurePoint === 'write') {
      throw new Error('Storage limit reached.');
    }
    if (this.corruptNextWrite) {
      this.corruptNextWrite = false;
      this.files.set(filePath, new Uint8Array([255]));
      return;
    }
    this.files.set(filePath, new Uint8Array(bytes));
  }

  async listEntries(_directoryPath: string): Promise<ObservabilityDirectoryEntry[]> {
    return [];
  }

  async stat(filePath: string): Promise<ObservabilityFileStat | undefined> {
    const value = this.files.get(filePath);
    return value
      ? { kind: 'file', size: value.byteLength, modifiedAtMs: 0 }
      : undefined;
  }

  async move(sourcePath: string, destinationPath: string): Promise<void> {
    this.operations.push(`move:${sourcePath}->${destinationPath}`);
    if (this.failurePoint === 'move') {
      throw new Error('Atomic move failed.');
    }
    const value = this.files.get(sourcePath);
    if (!value) {
      throw new Error('Source file not found.');
    }
    this.files.set(destinationPath, value);
    this.files.delete(sourcePath);
  }

  async removeFile(filePath: string): Promise<void> {
    this.operations.push(`remove:${filePath}`);
    this.files.delete(filePath);
  }

  filePaths(): string[] {
    return [...this.files.keys()].sort();
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
