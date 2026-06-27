// Defines retry lifecycle boundaries for manual retry and rerun orchestration.
export interface RunRetryInput {
  runId: string;
  retryKind: 'manual_retry' | 'manual_rerun';
  reason?: string;
  requestedAt: string;
}
