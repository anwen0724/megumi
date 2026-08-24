/* Defines the canonical, bounded file operations exposed by one Sandbox scope. */

export interface SandboxFileEntry {
  readonly name: string;
  readonly kind: 'file' | 'directory';
  readonly path: string;
}

export interface SandboxWalkWarning { readonly path: string; readonly code: string; readonly message: string }
export interface SandboxWalkResult {
  readonly files: readonly string[];
  readonly scannedFileCount: number;
  readonly skippedCount: number;
  readonly limitReached: boolean;
  readonly warnings: readonly SandboxWalkWarning[];
}

export interface SandboxTextEdit {
  readonly oldText: string;
  readonly newText: string;
}

export interface SandboxFileAccess {
  readBinaryFile(request: { readonly path: string; readonly signal?: AbortSignal }): Promise<{
    readonly path: string; readonly bytes: Uint8Array; readonly sizeBytes: number; readonly fingerprint: string;
  }>;
  readFile(request: { readonly path: string; readonly signal?: AbortSignal }): Promise<{
    readonly path: string; readonly content: string; readonly sizeBytes: number; readonly fingerprint: string;
  }>;
  listDirectory(request: { readonly path: string; readonly maxDepth: number; readonly includeHidden: boolean; readonly signal?: AbortSignal }): Promise<{
    readonly path: string; readonly entries: readonly SandboxFileEntry[];
  }>;
  walkFiles(request: { readonly path: string; readonly includeHidden?: boolean; readonly maxFiles?: number; readonly maxDepth?: number; readonly signal?: AbortSignal }): Promise<SandboxWalkResult>;
  editFile(request: { readonly path: string; readonly edits: readonly SandboxTextEdit[]; readonly expectedFingerprint?: string; readonly signal?: AbortSignal }): Promise<{
    readonly path: string; readonly replacements: number; readonly changed: boolean; readonly previousFingerprint: string; readonly fingerprint: string;
  }>;
  replaceText(request: { readonly path: string; readonly oldText: string; readonly newText: string; readonly replaceAll: boolean; readonly signal?: AbortSignal }): Promise<{
    readonly path: string; readonly replacements: number; readonly changed: boolean;
  }>;
  writeFile(request: { readonly path: string; readonly content: string; readonly overwrite: boolean; readonly expectedFingerprint?: string; readonly signal?: AbortSignal }): Promise<{
    readonly path: string; readonly bytesWritten: number; readonly created: boolean; readonly overwritten: boolean; readonly fingerprint: string;
  }>;
  createDirectory(request: { readonly path: string; readonly recursive: boolean; readonly signal?: AbortSignal }): Promise<{
    readonly path: string; readonly created: boolean;
  }>;
  copyPath(request: { readonly source: string; readonly destination: string; readonly overwrite: boolean; readonly signal?: AbortSignal }): Promise<{
    readonly source: string; readonly destination: string; readonly pathType: 'file' | 'directory';
  }>;
  movePath(request: { readonly source: string; readonly destination: string; readonly overwrite: boolean; readonly signal?: AbortSignal }): Promise<{
    readonly source: string; readonly destination: string; readonly pathType: 'file' | 'directory';
  }>;
  deletePath(request: { readonly path: string; readonly recursive: boolean; readonly signal?: AbortSignal }): Promise<{
    readonly path: string; readonly pathType: 'file' | 'directory'; readonly recoverable: true; readonly recoveryPath: string;
  }>;
  resolveCommandCwd(request: { readonly path: string; readonly signal?: AbortSignal }): Promise<string>;
}