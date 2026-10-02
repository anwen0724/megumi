/*
 * Defines the non-recursive host file capabilities used by Observability persistence.
 */
export type ObservabilityEntryKind = 'file' | 'directory';

export interface ObservabilityFileStat {
  readonly kind: ObservabilityEntryKind;
  readonly size: number;
  readonly modifiedAtMs: number;
}

export interface ObservabilityDirectoryEntry extends ObservabilityFileStat {
  readonly name: string;
}

export interface ObservabilityStorage {
  /** Creates one exact directory path and its missing parents. */
  ensureDirectory(directoryPath: string): Promise<void>;
  /** Appends UTF-8 text to one exact file path. */
  appendText(filePath: string, content: string): Promise<void>;
  /** Reads one exact file as UTF-8 text. */
  readText(filePath: string): Promise<string>;
  /** Reads one exact file as copied bytes. */
  readBytes(filePath: string): Promise<Uint8Array>;
  /** Reads one bounded byte range without loading the remainder of the file. */
  readBytesRange(filePath: string, offset: number, length: number): Promise<Uint8Array>;
  /** Replaces one exact file with the supplied bytes. */
  writeBytes(filePath: string, bytes: Uint8Array): Promise<void>;
  /** Lists direct children without recursive traversal. */
  listEntries(directoryPath: string): Promise<ObservabilityDirectoryEntry[]>;
  /** Returns metadata for one exact path when it exists. */
  stat(filePath: string): Promise<ObservabilityFileStat | undefined>;
  /** Atomically renames one exact path when supported by the host. */
  move(sourcePath: string, destinationPath: string): Promise<void>;
  /** Removes one exact file and never recursively deletes a directory. */
  removeFile(filePath: string): Promise<void>;
}
