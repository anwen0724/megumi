/*
 * Host-provided access to transient attachment references.
 */

export type LocalImageSource = {
  readonly type: "local_file";
  readonly path: string;
};

export type HostFileReference = {
  readonly type: "host_file_reference";
  readonly referenceId: string;
};

export type RawImageSource = LocalImageSource | HostFileReference;
export type RawDocumentSource = HostFileReference;

export interface InputSourceAccess {
  readImage(source: RawImageSource, options?: InputSourceOperationOptions): Promise<Uint8Array>;
  resolveDocument(
    source: RawDocumentSource,
    options?: InputSourceOperationOptions,
  ): Promise<{ readonly path: string; readonly sizeBytes: number }>;
}

export interface InputSourceOperationOptions {
  readonly signal?: AbortSignal;
}
