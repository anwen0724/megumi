/* Public read-side contract for the local developer diagnostics experience. */
import type {
  CreateDiagnosticBundleRequest,
  GetRunTraceRequest,
  ListRecentRunTracesRequest,
} from "../domain/dto/ui/observability-ui-request";
import type {
  CreateDiagnosticBundleResult,
  GetRunTraceResult,
  ListRecentRunTracesResult,
} from "../domain/dto/ui/observability-ui-response";
export interface ObservabilityQueryService {
  listRecentRunTraces(
    request: ListRecentRunTracesRequest,
  ): Promise<ListRecentRunTracesResult>;
  getRunTrace(request: GetRunTraceRequest): Promise<GetRunTraceResult>;
  createDiagnosticBundle(
    request: CreateDiagnosticBundleRequest,
  ): Promise<CreateDiagnosticBundleResult>;
}
