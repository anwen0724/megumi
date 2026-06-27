// Defines cancellation lifecycle boundaries for active and pending runs.
export interface CancelRunInput {
  runId: string;
  reason?: string;
}

export interface CancelRunPort {
  cancelRun(input: CancelRunInput): boolean;
}
