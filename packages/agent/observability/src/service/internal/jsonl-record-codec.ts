/* Encodes versioned records and tolerates malformed or partial JSONL lines during reads. */
import type { ObservabilityRecord } from "../../domain/model/observability-record";
export function encodeRecords(records: readonly ObservabilityRecord[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}
export function decodeRecords(text: string): ObservabilityRecord[] {
  return text.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const value = JSON.parse(line) as Partial<ObservabilityRecord>;
      return value.schemaVersion === 1 &&
        typeof value.recordId === "string" &&
        typeof value.type === "string"
        ? [value as ObservabilityRecord]
        : [];
    } catch {
      return [];
    }
  });
}
