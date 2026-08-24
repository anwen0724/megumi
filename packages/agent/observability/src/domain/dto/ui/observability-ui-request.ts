/* Defines diagnostics UI requests accepted by the Observability query owner. */
export type ListRecentRunTracesRequest = { limit?: number };
export type GetRunTraceRequest = { executionId: string };
export type CreateDiagnosticBundleRequest = { executionId: string };
