// @vitest-environment node
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildProviderApiKeySecretRef } from '@megumi/security/secret-policy';
import {
  SecretStoreEncryptionUnavailableError,
  SecretStoreService,
  type SecretStoreFileSystem,
  type SecretStoreSafeStorage,
} from '@megumi/desktop/main/services/security/secret-store.service';

class MemoryFileSystem implements SecretStoreFileSystem {
  readonly files = new Map<string, Buffer>();
  readonly directories = new Set<string>();

  async ensureDir(directoryPath: string): Promise<void> {
    this.directories.add(directoryPath);
  }

  async writeFile(filePath: string, data: Buffer): Promise<void> {
    this.files.set(filePath, Buffer.from(data));
  }

  async readFile(filePath: string): Promise<Buffer> {
    const data = this.files.get(filePath);

    if (!data) {
      throw new Error(`Missing file: ${filePath}`);
    }

    return Buffer.from(data);
  }

  async remove(filePath: string): Promise<void> {
    this.files.delete(filePath);
  }

  async pathExists(filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }
}

function createSafeStorage(encryptionAvailable = true): SecretStoreSafeStorage {
  return {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/, ''),
  };
}

describe('SecretStoreService', () => {
  let fileSystem: MemoryFileSystem;

  beforeEach(() => {
    fileSystem = new MemoryFileSystem();
  });

  it('stores and reads encrypted API keys by secret ref', async () => {
    const service = new SecretStoreService({
      userDataPath: 'C:/megumi-user-data',
      safeStorage: createSafeStorage(),
      fileSystem,
    });

    const ref = buildProviderApiKeySecretRef('deepseek');

    await service.setSecret(ref, 'sk-live-secret');

    expect(await service.hasSecret(ref)).toBe(true);
    expect(await service.readSecret(ref)).toBe('sk-live-secret');
    expect([...fileSystem.files.values()][0].toString('utf8')).toBe('encrypted:sk-live-secret');
  });

  it('uses stable sanitized file names', async () => {
    const service = new SecretStoreService({
      userDataPath: 'C:/megumi-user-data',
      safeStorage: createSafeStorage(),
      fileSystem,
    });

    const ref = buildProviderApiKeySecretRef('openai');

    await service.setSecret(ref, 'sk-openai');

    const expectedPath = path.join(
      'C:/megumi-user-data',
      'secrets',
      'providers',
      'openai.enc',
    );

    expect(fileSystem.files.has(expectedPath)).toBe(true);
  });

  it('stores valid provider secret refs on provider-specific paths', async () => {
    const service = new SecretStoreService({
      userDataPath: 'C:/megumi-user-data',
      safeStorage: createSafeStorage(),
      fileSystem,
    });

    await service.setSecret(buildProviderApiKeySecretRef('deepseek'), 'sk-custom');

    expect([...fileSystem.files.keys()]).toContain(
      path.join('C:/megumi-user-data', 'secrets', 'providers', 'deepseek.enc'),
    );
  });

  it('deletes stored secrets', async () => {
    const service = new SecretStoreService({
      userDataPath: 'C:/megumi-user-data',
      safeStorage: createSafeStorage(),
      fileSystem,
    });

    const ref = buildProviderApiKeySecretRef('anthropic');

    await service.setSecret(ref, 'sk-anthropic');
    await service.deleteSecret(ref);

    expect(await service.hasSecret(ref)).toBe(false);
    expect(await service.readSecret(ref)).toBeNull();
  });

  it('throws a typed error when encryption is unavailable', async () => {
    const service = new SecretStoreService({
      userDataPath: 'C:/megumi-user-data',
      safeStorage: createSafeStorage(false),
      fileSystem,
    });

    await expect(service.setSecret(buildProviderApiKeySecretRef('deepseek'), 'sk-live')).rejects.toBeInstanceOf(
      SecretStoreEncryptionUnavailableError,
    );
  });
});

