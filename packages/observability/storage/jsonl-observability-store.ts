/* Owns unified JSONL append, rotation and retention without exposing Node APIs. */
import type { ObservabilityRecord } from "../domain/model/observability-record";
import { encodeRecords } from "../service/internal/jsonl-record-codec";
import type { ObservabilityStorage } from "./observability-storage";
export const OBSERVABILITY_FILE_NAME = "observability.jsonl";
export class JsonlObservabilityStore {
  constructor(
    private readonly options: {
      directoryPath: string;
      storage: ObservabilityStorage;
      maxFileBytes?: number;
      maxFiles?: number;
      retentionMs?: number;
      nowMs?: () => number;
    },
  ) {}
  async append(records: readonly ObservabilityRecord[]): Promise<void> {
    if (records.length === 0) return;
    const content = encodeRecords(records);
    const maxBytes = this.options.maxFileBytes ?? 10 * 1024 * 1024;
    await this.options.storage.ensureDirectory(this.options.directoryPath);
    const current = await this.options.storage.stat(this.currentPath());
    if (current && current.size + Buffer.byteLength(content, "utf8") > maxBytes)
      await this.rotate();
    await this.options.storage.appendText(this.currentPath(), content);
    await this.cleanup();
  }
  private async rotate(): Promise<void> {
    const maxFiles = this.options.maxFiles ?? 5;
    await this.safeRemove(this.rotatedPath(maxFiles - 1));
    for (let index = maxFiles - 2; index >= 1; index -= 1)
      if (await this.options.storage.stat(this.rotatedPath(index)))
        await this.options.storage.move(
          this.rotatedPath(index),
          this.rotatedPath(index + 1),
        );
    await this.options.storage.move(this.currentPath(), this.rotatedPath(1));
  }
  private async cleanup(): Promise<void> {
    const cutoff =
      (this.options.nowMs ?? Date.now)() -
      (this.options.retentionMs ?? 14 * 24 * 60 * 60 * 1000);
    const maxFiles = this.options.maxFiles ?? 5;
    const files = (
      await this.options.storage.listFiles(this.options.directoryPath)
    )
      .filter(
        (file) =>
          file.name === OBSERVABILITY_FILE_NAME ||
          file.name.startsWith(`${OBSERVABILITY_FILE_NAME}.`),
      )
      .sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
    await Promise.all(
      files.flatMap((file, index) =>
        index >= maxFiles || file.modifiedAtMs < cutoff
          ? [this.safeRemove(joinPath(this.options.directoryPath, file.name))]
          : [],
      ),
    );
  }
  private async safeRemove(path: string): Promise<void> {
    try {
      await this.options.storage.remove(path);
    } catch {}
  }
  private currentPath(): string {
    return joinPath(this.options.directoryPath, OBSERVABILITY_FILE_NAME);
  }
  private rotatedPath(index: number): string {
    return `${this.currentPath()}.${index}`;
  }
}
export function joinPath(directory: string, name: string): string {
  const separator = directory.includes("\\") ? "\\" : "/";
  return `${directory.replace(/[\\/]$/, "")}${separator}${name}`;
}
