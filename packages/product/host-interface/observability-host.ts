/* Exposes Observability query use cases without reinterpreting diagnostic facts. */
import type {
  CreateDiagnosticBundleResult,
  GetRunTraceResult,
  ListRecentRunTracesResult,
  ObservabilityQueryService,
} from "@megumi/observability";
import { z } from "zod";
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
  }): Promise<ListRecentRunTracesResult>;
  getRunTrace(payload: { runId: string }): Promise<GetRunTraceResult>;
  createDiagnosticBundle(payload: {
    runId: string;
  }): Promise<CreateDiagnosticBundleResult>;
}
export function createObservabilityHost(
  service: ObservabilityQueryService,
): ObservabilityHost {
  return {
    listRecentRunTraces: (payload) =>
      service.listRecentRunTraces(
        ObservabilityListPayloadSchema.parse(payload),
      ),
    getRunTrace: (payload) =>
      service.getRunTrace(ObservabilityRunPayloadSchema.parse(payload)),
    createDiagnosticBundle: (payload) =>
      service.createDiagnosticBundle(
        ObservabilityRunPayloadSchema.parse(payload),
      ),
  };
}
