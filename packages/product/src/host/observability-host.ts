/*
 * Defines stable diagnostics DTOs exposed by the Product Host boundary.
 * These structures deliberately do not expose Observability Package types.
 */
import { z } from 'zod';

export const ObservabilityListPayloadSchema = z
  .object({ limit: z.number().int().min(1).max(200).optional() })
  .strict();

export const ObservabilityRunPayloadSchema = z
  .object({ runId: z.string().min(1) })
  .strict();

export const ObservabilityQueryResultSchema = z
  .object({ status: z.string() })
  .passthrough();

export interface ObservabilityHost {
  listRecentRunTraces(payload: {
    limit?: number;
  }): Promise<ObservabilityListRunTracesUiResult>;
  getRunTrace(payload: { runId: string }): Promise<ObservabilityGetRunTraceUiResult>;
  flush(): Promise<void>;
  exportDiagnosticBundle(payload: {
    runId: string;
  }): Promise<ObservabilityExportResult>;
}

export type ObservabilityRunStatus = 'ok' | 'error' | 'cancelled' | 'incomplete';

export type ObservabilityAttributeValue = string | number | boolean | null;
export type ObservabilityAttributesUiDto = Readonly<
  Record<string, ObservabilityAttributeValue>
>;

export type ObservabilitySpanName =
  | 'agent_run'
  | 'context.build'
  | 'context.compact'
  | 'model.call'
  | 'tool.call'
  | 'approval.wait'
  | 'session.append_message';

export type ObservabilityMeasurementUnit = 'count' | 'ms' | 'token' | 'ratio' | 'byte';

export interface ObservabilityRunTraceSummaryUiDto {
  traceId: string;
  runId: string;
  sessionId?: string;
  workspaceId?: string;
  status: ObservabilityRunStatus;
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

export interface ObservabilityRunTraceDetailUiDto {
  summary: ObservabilityRunTraceSummaryUiDto;
  spans: Array<{
    spanId: string;
    parentSpanId?: string;
    name: ObservabilitySpanName;
    status: ObservabilityRunStatus;
    startedAt: string;
    endedAt?: string;
    durationMs?: number;
    attributes: ObservabilityAttributesUiDto;
  }>;
  logs: Array<{
    timestamp: string;
    level: 'info' | 'warn' | 'error';
    event: string;
    attributes: ObservabilityAttributesUiDto;
  }>;
  measurements: Array<{
    timestamp: string;
    name: string;
    value: number;
    unit: ObservabilityMeasurementUnit;
    attributes: ObservabilityAttributesUiDto;
  }>;
  droppedRecordCount: number;
}

export type ObservabilityListRunTracesUiResult =
  | { status: 'ok'; traces: ObservabilityRunTraceSummaryUiDto[] }
  | { status: 'failed'; message: string };

export type ObservabilityGetRunTraceUiResult =
  | { status: 'found'; trace: ObservabilityRunTraceDetailUiDto }
  | { status: 'not_found' }
  | { status: 'failed'; message: string };

export interface DiagnosticBundleFileDto {
  relativePath: 'manifest.json' | 'run-traces.jsonl' | 'environment.json';
  content: string;
}

export interface DiagnosticBundleDto {
  suggestedDirectoryName: string;
  files: DiagnosticBundleFileDto[];
}

export type ObservabilityExportResult =
  | { status: 'saved'; directory: string }
  | { status: 'cancelled' }
  | { status: 'not_found' }
  | { status: 'failed'; message: string };
