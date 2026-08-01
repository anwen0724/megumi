/* Defines diagnostics UI requests accepted by the Observability query owner. */
export type ListRecentRunTracesRequest = { limit?: number };
export type GetRunTraceRequest = { runId: string };
export type CreateDiagnosticBundleRequest = { runId: string };
