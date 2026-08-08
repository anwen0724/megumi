/* Defines the host-provided local file opening capability used by Product. */
export type FileOpenResult =
  | { readonly status: 'opened' }
  | { readonly status: 'failed'; readonly message: string };

export interface FileOpener {
  openPath(absolutePath: string): Promise<FileOpenResult>;
}
