/*
 * Stable public entrypoint for the Engine package: the Runs operation
 * interface, its request/result contracts, the Run read-only results, the
 * creation entry and the caller-facing RunPolicy type. The Agent Loop, Run
 * Registry, internal runners, the committer and the loop observer are never
 * exported.
 */
export { createRuns } from './run';
export type {
  CancelRunRequest,
  CancelRunResult,
  CreateRunsOptions,
  GetActiveRunRequest,
  GetActiveRunResult,
  GetRunRequest,
  GetRunResult,
  ResolveApprovalRequest,
  ResolveApprovalResult,
  RunApprovalDecision,
  RunApproval,
  RunApprovalStatus,
  RunInput,
  RunClock,
  Runs,
  StartRunRequest,
  StartRunResult,
  ShutdownRunsRequest,
  ShutdownRunsResult,
} from './run';
export type { RunPolicy } from './run-policy';
export type {
  Run,
  RunFailure,
  RunFailureCode,
  RunStatus,
} from './run';
