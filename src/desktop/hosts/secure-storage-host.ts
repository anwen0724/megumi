// Wraps Electron safeStorage without exposing plaintext secrets to renderer.
import { safeStorage } from 'electron';

export interface SecureStorageHost {
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
  isAvailable(): boolean;
}

export function createSecureStorageHost(): SecureStorageHost {
  return {
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
    isAvailable: () => safeStorage.isEncryptionAvailable(),
  };
}
