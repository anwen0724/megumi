/*
 * Provides a deterministic in-memory implementation of the exact-path Observability storage port.
 */
import { basename, dirname } from 'node:path';
import type {
  ObservabilityDirectoryEntry,
  ObservabilityFileStat,
  ObservabilityStorage,
} from '../../../packages/agent/observability/src/persistence/observability-storage';

interface MemoryFile {
  readonly bytes: Uint8Array;
  readonly modifiedAtMs: number;
}

export class ObservabilityMemoryStorage implements ObservabilityStorage {
  readonly operations: string[] = [];
  failAppend = false;
  failMove = false;
  failRemove = false;
  failWrite = false;
  appendGate: Promise<void> | undefined;

  private readonly files = new Map<string, MemoryFile>();
  private readonly directories = new Set<string>();
  private clock = 0;

  /** Creates the requested directory and its path ancestors. */
  async ensureDirectory(directoryPath: string): Promise<void> {
    let current = directoryPath;
    while (current && !this.directories.has(current)) {
      this.directories.add(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    this.operations.push(`directory:${directoryPath}`);
  }

  /** Appends UTF-8 bytes to one in-memory file. */
  async appendText(filePath: string, content: string): Promise<void> {
    this.operations.push(`append:${filePath}`);
    await this.appendGate;
    if (this.failAppend) throw new Error('Append failed.');
    const existing = this.files.get(filePath)?.bytes ?? new Uint8Array();
    const addition = new TextEncoder().encode(content);
    const combined = new Uint8Array(existing.byteLength + addition.byteLength);
    combined.set(existing);
    combined.set(addition, existing.byteLength);
    this.setFile(filePath, combined);
  }

  /** Reads one in-memory file as UTF-8. */
  async readText(filePath: string): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(filePath));
  }

  /** Reads a defensive byte copy from one in-memory file. */
  async readBytes(filePath: string): Promise<Uint8Array> {
    const file = this.files.get(filePath);
    if (!file) throw new Error(`Missing file: ${filePath}`);
    return new Uint8Array(file.bytes);
  }

  /** Replaces one in-memory file with a defensive byte copy. */
  async writeBytes(filePath: string, bytes: Uint8Array): Promise<void> {
    this.operations.push(`write:${filePath}`);
    if (this.failWrite) throw new Error('Write failed.');
    this.setFile(filePath, bytes);
  }

  /** Lists direct file and directory children in deliberately unstable order. */
  async listEntries(directoryPath: string): Promise<ObservabilityDirectoryEntry[]> {
    const entries: ObservabilityDirectoryEntry[] = [];
    for (const [filePath, file] of this.files) {
      if (dirname(filePath) === directoryPath) {
        entries.unshift({
          name: basename(filePath),
          kind: 'file',
          size: file.bytes.byteLength,
          modifiedAtMs: file.modifiedAtMs,
        });
      }
    }
    for (const childPath of this.directories) {
      if (childPath !== directoryPath && dirname(childPath) === directoryPath) {
        entries.unshift({
          name: basename(childPath),
          kind: 'directory',
          size: 0,
          modifiedAtMs: 0,
        });
      }
    }
    return entries;
  }

  /** Returns exact-path metadata. */
  async stat(filePath: string): Promise<ObservabilityFileStat | undefined> {
    const file = this.files.get(filePath);
    if (file) {
      return { kind: 'file', size: file.bytes.byteLength, modifiedAtMs: file.modifiedAtMs };
    }
    return this.directories.has(filePath)
      ? { kind: 'directory', size: 0, modifiedAtMs: 0 }
      : undefined;
  }

  /** Moves one exact in-memory file. */
  async move(sourcePath: string, destinationPath: string): Promise<void> {
    this.operations.push(`move:${sourcePath}->${destinationPath}`);
    if (this.failMove) throw new Error('Move failed.');
    const source = this.files.get(sourcePath);
    if (!source) throw new Error(`Missing source: ${sourcePath}`);
    this.setFile(destinationPath, source.bytes);
    this.files.delete(sourcePath);
  }

  /** Removes one exact in-memory file. */
  async removeFile(filePath: string): Promise<void> {
    this.operations.push(`remove:${filePath}`);
    if (this.failRemove) throw new Error('Remove failed.');
    this.files.delete(filePath);
  }

  /** Seeds a UTF-8 file for persistence and retention tests. */
  seedText(filePath: string, content: string, modifiedAtMs = 0): void {
    this.files.set(filePath, {
      bytes: new TextEncoder().encode(content),
      modifiedAtMs,
    });
    this.addDirectory(dirname(filePath));
  }

  /** Seeds a binary file for persistence and retention tests. */
  seedBytes(filePath: string, bytes: Uint8Array, modifiedAtMs = 0): void {
    this.files.set(filePath, { bytes: new Uint8Array(bytes), modifiedAtMs });
    this.addDirectory(dirname(filePath));
  }

  /** Returns all exact file paths in stable order. */
  filePaths(): string[] {
    return [...this.files.keys()].sort();
  }

  private setFile(filePath: string, bytes: Uint8Array): void {
    this.clock += 1;
    this.files.set(filePath, {
      bytes: new Uint8Array(bytes),
      modifiedAtMs: this.clock,
    });
    this.addDirectory(dirname(filePath));
  }

  private addDirectory(directoryPath: string): void {
    let current = directoryPath;
    while (current && !this.directories.has(current)) {
      this.directories.add(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
}
