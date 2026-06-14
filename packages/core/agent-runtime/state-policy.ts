// Defines pure Agent Run state policy for core runtime and Desktop Main.
// This module owns lifecycle classification and transition guards; it does
// not persist records, call providers, execute tools, or know about Electron.
import type { RuntimeError } from '@megumi/shared/runtime';
import {
  RUN_TERMINAL_REASONS,
  type Run,
  type RunStatus,
  type RunTerminalReason,
} from '@megumi/shared/session';

export const ACTIVE_RUN_STATUSES = [
  'queued',
  'running',
  'waiting_for_approval',
  'paused',
  'cancelling',
] as const satisfies readonly RunStatus[];

export const TERMINAL_RUN_STATUSES = [
  'completed',
  'failed',
  'cancelled',
] as const satisfies readonly RunStatus[];

export const CANCELLABLE_RUN_STATUSES = [
  'queued',
  'running',
  'waiting_for_approval',
] as const satisfies readonly RunStatus[];

const LEGAL_RUN_STATUS_TRANSITIONS = new Set<string>([
  'queued->running',
  'running->waiting_for_approval',
  'waiting_for_approval->running',
  'waiting_for_approval->cancelling',
  'running->cancelling',
  'queued->cancelling',
  'cancelling->cancelled',
  'running->completed',
  'running->failed',
  'waiting_for_approval->failed',
  'queued->failed',
]);

const RUN_TERMINAL_REASON_SET = new Set<string>(RUN_TERMINAL_REASONS);

export function isActiveRunStatus(status: RunStatus): boolean {
  return (ACTIVE_RUN_STATUSES as readonly RunStatus[]).includes(status);
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(status);
}

export function canCancelRunStatus(status: RunStatus): boolean {
  return (CANCELLABLE_RUN_STATUSES as readonly RunStatus[]).includes(status);
}

export function canResumeApprovalFromRunStatus(status: RunStatus): boolean {
  return status === 'waiting_for_approval';
}

export function canTransitionRunStatus(from: RunStatus, to: RunStatus): boolean {
  if (from === to) {
    return true;
  }
  if (isTerminalRunStatus(from)) {
    return false;
  }
  return LEGAL_RUN_STATUS_TRANSITIONS.has(`${from}->${to}`);
}

export function assertRunStatusTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRunStatus(from, to)) {
    throw new Error(`Illegal run status transition: ${from} -> ${to}`);
  }
}

export function getTerminalReason(error: RuntimeError | undefined): RunTerminalReason | undefined {
  const reason = error?.details && typeof error.details === 'object'
    ? (error.details as Record<string, unknown>).reason
    : undefined;
  return typeof reason === 'string' && RUN_TERMINAL_REASON_SET.has(reason)
    ? reason as RunTerminalReason
    : undefined;
}

export function assertFailedRunHasTerminalReason(run: Pick<Run, 'status' | 'error'>): void {
  if (run.status !== 'failed') {
    return;
  }
  if (!getTerminalReason(run.error)) {
    throw new Error('Failed run must include a terminal reason.');
  }
}

export function createTerminalRuntimeError(input: {
  reason: RunTerminalReason;
  code: RuntimeError['code'];
  message: string;
  source: RuntimeError['source'];
  retryable?: boolean;
  debugId?: string;
  details?: Record<string, unknown>;
}): RuntimeError {
  return {
    code: input.code,
    message: input.message,
    severity: 'error',
    retryable: input.retryable ?? false,
    source: input.source,
    ...(input.debugId ? { debugId: input.debugId } : {}),
    details: {
      ...(input.details ?? {}),
      reason: input.reason,
    },
  };
}
