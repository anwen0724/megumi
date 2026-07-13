/* Reads current and rotated observability files in chronological file order. */
import type { ObservabilityRecord } from "../../domain/model/observability-record";
import {
  OBSERVABILITY_FILE_NAME,
  joinPath,
} from "../../storage/jsonl-observability-store";
import type { ObservabilityStorage } from "../../storage/observability-storage";
import { decodeRecords } from "./jsonl-record-codec";
export class LocalRecordReader {
  constructor(
    private readonly directoryPath: string,
    private readonly storage: ObservabilityStorage,
  ) {}
  async readAll(): Promise<ObservabilityRecord[]> {
    const files = (await this.storage.listFiles(this.directoryPath))
      .filter(
        (f) =>
          f.name === OBSERVABILITY_FILE_NAME ||
          f.name.startsWith(`${OBSERVABILITY_FILE_NAME}.`),
      )
      .sort((a, b) => a.modifiedAtMs - b.modifiedAtMs);
    const records: ObservabilityRecord[] = [];
    for (const file of files) {
      try {
        records.push(
          ...decodeRecords(
            await this.storage.readText(
              joinPath(this.directoryPath, file.name),
            ),
          ),
        );
      } catch {}
    }
    return records.sort(
      (a, b) =>
        a.timestamp.localeCompare(b.timestamp) || a.sequence - b.sequence,
    );
  }
}
