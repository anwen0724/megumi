/*
 * Defines stable diagnostics DTOs exposed by the Product Host boundary.
 * These structures deliberately do not expose Observability Package types.
 */
import { z } from 'zod';

export const ObservabilityListPayloadSchema = z
  .object({ limit: z.number().int().min(1).max(200).optional() })
  .strict();

export const ObservabilityRunPayloadSchema = z
  .object({ executionId: z.string().min(1) })
  .strict();

export const ObservabilityQueryResultSchema = z
  .object({ status: z.string() })
  .passthrough();

export interface ObservabilityHost {
  listRecentRunTraces(payload: {
    limit?: number;
  }): Promise<ObservabilityListRunTracesUiResult>;
  getRunTrace(payload: { executionId: string }): Promise<ObservabilityGetRunTraceUiResult>;
  flush(): Promise<void>;
  exportDiagnosticBundle(payload: {
    executionId: string;
  }): Promise<ObservabilityExportResult>;
}

export type ObservabilityRunStatus = 'ok' | 'error' | 'cancelled' | 'incomplete';

export type ObservabilityAttributeValue = string | number | boolean | null;
export type ObservabilityAttributesUiDto = Readonly<
  Record<string, ObservabilityAttributeValue>
>;

export type ObservabilitySpanName =
  | 'model.resolve'
  | 'input.process'
  | 'session.resolve'
  | 'session.create'
  | 'session.branch.resolve'
  | 'session.branch.commit'
  | 'session.message.commit'
  | 'recommendation.reference.resolve'
  | 'agent.execution'
  | 'context.build'
  | 'context.resolve'
  | 'context.compact'
  | 'prompt.build'
  | 'model.call'
  | 'tool.call'
  | 'permission.await'
  | 'discovery.preflight'
  | 'source.availability.check'
  | 'discovery.batch.claim'
  | 'discovery.attempt'
  | 'source.search'
  | 'source.read'
  | 'discovery.selection'
  | 'discovery.attempt.settle'
  | 'recommendation.publish';

export type ObservabilityMeasurementUnit = 'count' | 'ms' | 'token' | 'ratio' | 'byte';

export interface ObservabilityRunTraceSummaryUiDto {
  traceId: string;
  executionId: string;
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
  relativePath: string;
  content: string | Uint8Array;
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
