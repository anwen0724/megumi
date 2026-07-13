/* Defines the versioned metadata-only records stored in the local JSONL stream. */
import type { MeasurementUnit } from "./measurement";
import type { ObservabilitySpanName } from "./span";
import type { ObservabilityCorrelation, ObservabilityStatus } from "./trace";

export type ObservabilityAttributeValue = string | number | boolean | null;
export type ObservabilityAttributes = Readonly<
  Record<string, ObservabilityAttributeValue>
>;

interface RecordBase {
  schemaVersion: 1;
  recordId: string;
  timestamp: string;
  sequence: number;
  correlation: ObservabilityCorrelation;
  attributes: ObservabilityAttributes;
}

export type ObservabilityRecord =
  | (RecordBase & { type: "trace.started"; name: "agent_run" })
  | (RecordBase & {
      type: "trace.ended";
      name: "agent_run";
      status: Exclude<ObservabilityStatus, "incomplete">;
      durationMs: number;
    })
  | (RecordBase & { type: "span.started"; name: ObservabilitySpanName })
  | (RecordBase & {
      type: "span.ended";
      name: ObservabilitySpanName;
      status: Exclude<ObservabilityStatus, "incomplete">;
      durationMs: number;
    })
  | (RecordBase & {
      type: "log";
      level: "info" | "warn" | "error";
      event: string;
    })
  | (RecordBase & {
      type: "measurement";
      name: string;
      value: number;
      unit: MeasurementUnit;
    });
