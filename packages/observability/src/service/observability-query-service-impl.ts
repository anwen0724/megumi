/* Implements queries solely from the Observability local store. */
import type { DiagnosticEnvironment } from "../domain/model/diagnostic-bundle";
import { buildDiagnosticBundle } from "./internal/diagnostic-bundle-builder";
import type { LocalRecordReader } from "./internal/local-record-reader";
import { projectRunTrace } from "./internal/run-trace-projector";
import type { ObservabilityQueryService } from "./observability-query-service";
export class ObservabilityQueryServiceImpl implements ObservabilityQueryService {
  constructor(
    private readonly reader: LocalRecordReader,
    private readonly dropped: () => number,
    private readonly environment: () => DiagnosticEnvironment,
    private readonly now: () => Date,
  ) {}
  async listRecentRunTraces({ limit = 50 }: { limit?: number }) {
    try {
      const records = await this.reader.readAll();
      const ids = [
        ...new Set(
          records.flatMap((r) =>
            r.correlation.traceId ? [r.correlation.traceId] : [],
          ),
        ),
      ];
      return {
        status: "ok" as const,
        traces: ids
          .flatMap((id) => {
            const d = projectRunTrace(id, records, this.dropped());
            return d ? [d.summary] : [];
          })
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .slice(0, Math.max(1, Math.min(limit, 200))),
      };
    } catch (error) {
      return {
        status: "failed" as const,
        message:
          error instanceof Error ? error.message : "Diagnostics query failed.",
      };
    }
  }
  async getRunTrace({ executionId }: { executionId: string }) {
    try {
      const records = await this.reader.readAll();
      const id = records.find((r) => r.correlation.executionId === executionId)?.correlation
        .traceId;
      if (!id) return { status: "not_found" as const };
      const trace = projectRunTrace(id, records, this.dropped());
      return trace
        ? { status: "found" as const, trace }
        : { status: "not_found" as const };
    } catch (error) {
      return {
        status: "failed" as const,
        message:
          error instanceof Error ? error.message : "Diagnostics query failed.",
      };
    }
  }
  async createDiagnosticBundle({ executionId }: { executionId: string }) {
    const result = await this.getRunTrace({ executionId });
    if (result.status !== "found") return result;
    return {
      status: "created" as const,
      bundle: buildDiagnosticBundle(
        result.trace,
        this.environment(),
        this.now(),
      ),
    };
  }
}
