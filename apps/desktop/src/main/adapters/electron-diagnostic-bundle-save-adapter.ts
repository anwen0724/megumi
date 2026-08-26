/* Saves an explicit diagnostic bundle after the user chooses a parent directory. */
import { dialog } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DiagnosticBundleDto } from '@megumi/product-host';
export async function saveDiagnosticBundle(
  bundle: DiagnosticBundleDto,
): Promise<
  | { status: "saved"; directory: string }
  | { status: "cancelled" }
  | { status: "failed"; message: string }
> {
  try {
    const selected = await dialog.showOpenDialog({
      title: "Export Megumi diagnostic bundle",
      properties: ["openDirectory", "createDirectory"],
    });
    if (selected.canceled || !selected.filePaths[0])
      return { status: "cancelled" };
    const directory = path.join(
      selected.filePaths[0],
      bundle.suggestedDirectoryName,
    );
    await mkdir(directory, { recursive: true });
    for (const file of bundle.files) {
      const target = path.resolve(directory, file.relativePath);
      const relative = path.relative(path.resolve(directory), target);
      if (
        relative.length === 0
        || relative === '..'
        || relative.startsWith(`..${path.sep}`)
        || path.isAbsolute(relative)
      ) {
        throw new Error("Invalid diagnostic bundle path.");
      }
      await mkdir(path.dirname(target), { recursive: true });
      if (typeof file.content === 'string') {
        await writeFile(target, file.content, 'utf8');
      } else {
        await writeFile(target, file.content);
      }
    }
    return { status: "saved", directory };
  } catch (error) {
    return {
      status: "failed",
      message:
        error instanceof Error
          ? error.message
          : "Diagnostic bundle export failed.",
    };
  }
}
