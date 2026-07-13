/* Exposes Observability queries and coordinates host-owned bundle persistence. */
import type {
  DiagnosticBundle,
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
export type ObservabilityExportResult =
  | { status: "saved"; directory: string }
  | { status: "cancelled" }
  | { status: "not_found" }
  | { status: "failed"; message: string };
export interface DiagnosticBundleSavePort {
  save(bundle: DiagnosticBundle): Promise<ObservabilityExportResult>;
}
export interface ObservabilityHost {
  listRecentRunTraces(payload: {
    limit?: number;
  }): Promise<ListRecentRunTracesResult>;
  getRunTrace(payload: { runId: string }): Promise<GetRunTraceResult>;
  exportDiagnosticBundle(payload: {
    runId: string;
  }): Promise<ObservabilityExportResult>;
}
export function createObservabilityHost(
  service: ObservabilityQueryService,
  savePort?: DiagnosticBundleSavePort,
): ObservabilityHost {
  return {
    listRecentRunTraces: (p) =>
      service.listRecentRunTraces(ObservabilityListPayloadSchema.parse(p)),
    getRunTrace: (p) =>
      service.getRunTrace(ObservabilityRunPayloadSchema.parse(p)),
    exportDiagnosticBundle: async (p) => {
      const result = await service.createDiagnosticBundle(
        ObservabilityRunPayloadSchema.parse(p),
      );
      if (result.status !== "created") return result;
      return savePort
        ? savePort.save(result.bundle)
        : {
            status: "failed",
            message: "Diagnostic bundle save capability is unavailable.",
          };
    },
  };
}
