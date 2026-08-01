/* Defines diagnostics UI projections without exposing storage implementation details. */
import type { ObservabilityAttributes } from "../../model/observability-record";
import type { MeasurementUnit } from "../../model/measurement";
import type { ObservabilitySpanName } from "../../model/span";
import type { ObservabilityStatus } from "../../model/trace";
import type { DiagnosticBundle } from "../../model/diagnostic-bundle";

export interface RunTraceSummary {
  traceId: string;
  runId: string;
  sessionId?: string;
  workspaceId?: string;
  status: ObservabilityStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  providerId?: string;
  modelId?: string;
  modelCallCount: number;
  toolCallCount: number;
  contextUsedTokens?: number;
  contextWindowTokens?: number;
  contextUsedRatio?: number;
  providerInputTokens?: number;
  providerOutputTokens?: number;
}

export interface RunTraceDetail {
  summary: RunTraceSummary;
  spans: Array<{
    spanId: string;
    parentSpanId?: string;
    name: ObservabilitySpanName;
    status: ObservabilityStatus;
    startedAt: string;
    endedAt?: string;
    durationMs?: number;
    attributes: ObservabilityAttributes;
  }>;
  logs: Array<{
    timestamp: string;
    level: "info" | "warn" | "error";
    event: string;
    attributes: ObservabilityAttributes;
  }>;
  measurements: Array<{
    timestamp: string;
    name: string;
    value: number;
    unit: MeasurementUnit;
    attributes: ObservabilityAttributes;
  }>;
  droppedRecordCount: number;
}

export type ListRecentRunTracesResult =
  | { status: "ok"; traces: RunTraceSummary[] }
  | { status: "failed"; message: string };
export type GetRunTraceResult =
  | { status: "found"; trace: RunTraceDetail }
  | { status: "not_found" }
  | { status: "failed"; message: string };
export type CreateDiagnosticBundleResult =
  | { status: "created"; bundle: DiagnosticBundle }
  | { status: "not_found" }
  | { status: "failed"; message: string };
