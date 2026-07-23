/* Guards text-only mutation tools from corrupting known structured binary documents. */
import path from 'node:path';

export function assertTextMutationTarget(targetPath: string): void {
  const extension = path.extname(targetPath).toLowerCase();
  if (extension === '.docx' || extension === '.pdf') {
    throw new Error(
      `${extension.slice(1).toUpperCase()} structured editing is not supported by text file tools.`,
    );
  }
}
