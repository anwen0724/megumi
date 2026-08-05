/*
 * Stable public entrypoint for the Engine package: the Engine interface, its
 * request/result contracts, the Run read-only results and the creation entry.
 * Internal loop, ActiveRun and attempt work data are never exported.
 */
export { createEngine } from './engine';
export type {
  CancelRunRequest,
  CancelRunResult,
  CreateEngineOptions,
  Engine,
  EngineClock,
  GetRunRequest,
  GetRunResult,
  EngineIdFactory,
  ResolveApprovalRequest,
  ResolveApprovalResult,
  RunApprovalDecision,
  RunApproval,
  RunApprovalStatus,
  RunInput,
  StartRunRequest,
  StartRunResult,
  ShutdownEngineRequest,
  ShutdownEngineResult,
} from './engine';
export type { EnginePolicy } from './engine-policy';
export type {
  Run,
  RunFailure,
  RunFailureCode,
  RunStatus,
} from './run';
