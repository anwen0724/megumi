/* Exposes Observability queries and coordinates host-owned bundle persistence. */
import type { ObservabilityQueryService } from '@megumi/observability';
import { z } from 'zod';
import type {
  DiagnosticBundleDto,
  ObservabilityExportResult,
  ObservabilityGetRunTraceUiResult,
  ObservabilityListRunTracesUiResult,
} from './observability-contract';

export const ObservabilityListPayloadSchema = z
  .object({ limit: z.number().int().min(1).max(200).optional() })
  .strict();

export const ObservabilityRunPayloadSchema = z
  .object({ runId: z.string().min(1) })
  .strict();

export const ObservabilityQueryResultSchema = z
  .object({ status: z.string() })
  .passthrough();

export interface DiagnosticBundleSavePort {
  save(bundle: DiagnosticBundleDto): Promise<ObservabilityExportResult>;
}

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

export function createObservabilityHost(
  request: {
    queries: ObservabilityQueryService;
    flush(): Promise<void>;
    save?: DiagnosticBundleSavePort;
  },
): ObservabilityHost {
  return {
    listRecentRunTraces: (p) =>
      request.queries.listRecentRunTraces(ObservabilityListPayloadSchema.parse(p)),
    getRunTrace: (p) =>
      request.queries.getRunTrace(ObservabilityRunPayloadSchema.parse(p)),
    flush: () => request.flush(),
    exportDiagnosticBundle: async (p) => {
      const result = await request.queries.createDiagnosticBundle(
        ObservabilityRunPayloadSchema.parse(p),
      );
      if (result.status !== 'created') return result;
      return request.save
        ? request.save.save(result.bundle)
        : {
            status: 'failed',
            message: 'Diagnostic bundle save capability is unavailable.',
          };
    },
  };
}
