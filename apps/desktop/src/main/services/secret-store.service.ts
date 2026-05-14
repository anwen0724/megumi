import { safeStorage } from 'electron';
import fs from 'fs-extra';
import path from 'path';
import { isSecretRef } from '@megumi/security/secret-policy';
import type { SecretRef } from '@megumi/shared/provider-contracts';

export interface SecretStoreSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface SecretStoreFileSystem {
  ensureDir(directoryPath: string): Promise<void>;
  writeFile(filePath: string, data: Buffer): Promise<void>;
  readFile(filePath: string): Promise<Buffer>;
  remove(filePath: string): Promise<void>;
  pathExists(filePath: string): Promise<boolean>;
}

export interface SecretStoreServiceOptions {
  userDataPath: string;
  safeStorage: SecretStoreSafeStorage;
  fileSystem: SecretStoreFileSystem;
}

export class SecretStoreEncryptionUnavailableError extends Error {
  readonly code = 'secret_store_encryption_unavailable';

  constructor() {
    super('Electron safeStorage encryption is not available on this system.');
    this.name = 'SecretStoreEncryptionUnavailableError';
  }
}

export class InvalidSecretRefError extends Error {
  readonly code = 'invalid_secret_ref';

  constructor() {
    super('Secret reference is invalid.');
    this.name = 'InvalidSecretRefError';
  }
}

export class SecretStoreService {
  constructor(private readonly options: SecretStoreServiceOptions) {}

  async setSecret(ref: SecretRef, value: string): Promise<void> {
    this.assertSecretRef(ref);

    if (!this.options.safeStorage.isEncryptionAvailable()) {
      throw new SecretStoreEncryptionUnavailableError();
    }

    const filePath = this.getSecretPath(ref);
    await this.options.fileSystem.ensureDir(path.dirname(filePath));
    await this.options.fileSystem.writeFile(filePath, this.options.safeStorage.encryptString(value));
  }

  async readSecret(ref: SecretRef): Promise<string | null> {
    this.assertSecretRef(ref);

    const filePath = this.getSecretPath(ref);

    if (!(await this.options.fileSystem.pathExists(filePath))) {
      return null;
    }

    const encrypted = await this.options.fileSystem.readFile(filePath);
    return this.options.safeStorage.decryptString(encrypted);
  }

  async hasSecret(ref: SecretRef): Promise<boolean> {
    this.assertSecretRef(ref);
    return this.options.fileSystem.pathExists(this.getSecretPath(ref));
  }

  async deleteSecret(ref: SecretRef): Promise<void> {
    this.assertSecretRef(ref);
    await this.options.fileSystem.remove(this.getSecretPath(ref));
  }

  private getSecretPath(ref: SecretRef): string {
    return path.join(this.options.userDataPath, 'secrets', 'providers', `${ref.providerId}.enc`);
  }

  private assertSecretRef(ref: SecretRef): void {
    if (!isSecretRef(ref)) {
      throw new InvalidSecretRefError();
    }
  }
}

export function createElectronSecretStoreService(userDataPath: string): SecretStoreService {
  return new SecretStoreService({
    userDataPath,
    safeStorage,
    fileSystem: fs,
  });
}
