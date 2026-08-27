/*
 * Owns the stable ContextFailure expressions: cancellation, source read and
 * attachment failures, policy, compaction Summary model failures, compaction
 * persistence failures and unexpected exceptions. Flow owners decide where a
 * failure happens; this module only builds the failure values and never
 * records state.
 */

import type { ContextFailure, ContextFailureCode } from './context';

export function buildCancelledContextFailure(message: string): ContextFailure {
  return {
    code: 'cancelled',
    message,
    retryable: true,
  };
}

/** Builds a failure that keeps the failing source Owner and its original code. */
export function buildSourceContextFailure(input: {
  readonly code: ContextFailureCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly owner: 'session' | 'workspace' | 'instructions' | 'skills' | 'tools' | 'ai' | 'discovery';
  readonly sourceCode?: string;
}): ContextFailure {
  return {
    code: input.code,
    message: input.message,
    retryable: input.retryable,
    cause: {
      owner: input.owner,
      ...(input.sourceCode ? { code: input.sourceCode } : {}),
    },
  };
}

export function buildPolicyContextFailure(message: string): ContextFailure {
  return {
    code: 'policy_invalid',
    message,
    retryable: false,
  };
}

/** The stable failure for an exception no flow owner recognizes. */
export function buildUnexpectedContextFailure(input: {
  readonly code: 'context_build_failed' | 'compaction_failed';
  readonly message: string;
}): ContextFailure {
  return {
    code: input.code,
    message: input.message,
    retryable: false,
  };
}

/** Summary model failure: keeps the AI Owner and the provider error code. */
export function buildSummaryModelContextFailure(error: unknown): ContextFailure {
  const candidate = typeof error === 'object' && error !== null
    ? error as { code?: unknown; message?: unknown; retryable?: unknown }
    : undefined;
  return {
    code: 'compaction_failed',
    message: resolveFailureMessage(error, candidate),
    retryable: typeof candidate?.retryable === 'boolean' ? candidate.retryable : true,
    cause: {
      owner: 'ai',
      ...(typeof candidate?.code === 'string' ? { code: candidate.code } : {}),
    },
  };
}

/** Compaction Summary persistence failure: keeps the Session Owner and code. */
export function buildCompactionPersistContextFailure(input: {
  readonly message: string;
  readonly sourceCode?: string;
}): ContextFailure {
  return {
    code: 'compaction_persist_failed',
    message: input.message,
    retryable: true,
    cause: {
      owner: 'session',
      ...(input.sourceCode ? { code: input.sourceCode } : {}),
    },
  };
}

/** Stable failed result wrapper shared by every Context flow owner. */
export function buildFailedContextResult<T extends ContextFailure>(
  failure: T,
): { readonly status: 'failed'; readonly failure: T } {
  return { status: 'failed', failure };
}

function resolveFailureMessage(
  error: unknown,
  candidate: { readonly message?: unknown } | undefined,
): string {
  if (typeof candidate?.message === 'string') return candidate.message;
  if (typeof error === 'string') return error;
  return 'Compaction summary model call failed.';
}
