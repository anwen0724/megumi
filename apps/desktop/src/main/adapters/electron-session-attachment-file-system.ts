/* Implements Session managed attachment storage with Node filesystem capabilities. */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { ProductSessionAttachmentFileSystem } from '@megumi/product/composition';

export const electronSessionAttachmentFileSystem: ProductSessionAttachmentFileSystem = {
  ensureDirectory: (directoryPath) => mkdir(directoryPath, { recursive: true }).then(() => undefined),
  writeFile: (filePath, bytes) => writeFile(filePath, bytes),
  moveFile: (sourcePath, targetPath) => rename(sourcePath, targetPath),
  readFile: async (filePath) => new Uint8Array(await readFile(filePath)),
  removeFile: (filePath) => rm(filePath, { force: true }),
};
