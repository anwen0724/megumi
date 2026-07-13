/* Saves an explicit diagnostic bundle after the user chooses a parent directory. */
import { dialog } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DiagnosticBundle } from "@megumi/observability";
export async function saveDiagnosticBundle(
  bundle: DiagnosticBundle,
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
      if (path.dirname(target) !== path.resolve(directory))
        throw new Error("Invalid diagnostic bundle path.");
      await writeFile(target, file.content, "utf8");
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
