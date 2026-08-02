/*
 * Defines the public Run snapshot and the internal lifecycle transition invariant.
 */
import type { Api, Model } from '@megumi/ai';
import type { PermissionMode } from '@megumi/permissions';
import type { SkillSelection } from '@megumi/skills';

export type RunStatus =
  | 'running'
  | 'waiting'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RunFailureCode =
  | 'session_failed'
  | 'context_failed'
  | 'model_call_failed'
  | 'permission_failed'
  | 'tool_system_failed'
  | 'loop_limit_exceeded'
  | 'runtime_protocol_violation'
  | 'cancellation_failed'
  | 'internal_error';

export interface RunFailure {
  readonly code: RunFailureCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: RunFailureCause;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface RunFailureCause {
  readonly owner: 'ai' | 'context' | 'permissions' | 'tools' | 'session' | 'engine';
  readonly code: string;
}

export interface Run {
  readonly runId: string;
  readonly requestId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly parentEntryId?: string;
  readonly userMessageId: string;
  readonly model: Model<Api>;
  readonly permissionMode: PermissionMode;
  readonly selectedSkill?: SkillSelection;
  readonly status: RunStatus;
  readonly createdAt: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly failure?: RunFailure;
}

export interface CreateRunInput {
  readonly runId: string;
  readonly requestId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly parentEntryId?: string;
  readonly userMessageId: string;
  readonly model: Model<Api>;
  readonly permissionMode: PermissionMode;
  readonly selectedSkill?: SkillSelection;
  readonly createdAt: string;
}

export type RunTransition =
  | {
      readonly status: Exclude<RunStatus, 'failed'>;
      readonly at: string;
      readonly failure?: never;
    }
  | {
      readonly status: 'failed';
      readonly at: string;
      readonly failure: RunFailure;
    };

const ALLOWED_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  running: ['waiting', 'cancelling', 'completed', 'failed'],
  waiting: ['running', 'cancelling', 'failed'],
  cancelling: ['cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
};

const TERMINAL_STATUSES: readonly RunStatus[] = ['completed', 'failed', 'cancelled'];

export class RunTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunTransitionError';
  }
}

export function createRun(input: CreateRunInput): Run {
  return {
    ...input,
    status: 'running',
    startedAt: input.createdAt,
  };
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function transitionRun(run: Run, transition: RunTransition): Run {
  if (!ALLOWED_TRANSITIONS[run.status].includes(transition.status)) {
    throw new RunTransitionError(
      `Invalid Run transition from ${run.status} to ${transition.status}.`,
    );
  }

  if (transition.status === 'failed' && transition.failure === undefined) {
    throw new RunTransitionError('Run failure is required when entering failed.');
  }

  if (transition.status !== 'failed' && transition.failure !== undefined) {
    throw new RunTransitionError('Run failure is only valid when entering failed.');
  }

  const terminal = isTerminalRunStatus(transition.status);
  return {
    ...run,
    status: transition.status,
    ...(terminal ? { completedAt: transition.at } : {}),
    ...(transition.status === 'failed' ? { failure: transition.failure } : {}),
  };
}
