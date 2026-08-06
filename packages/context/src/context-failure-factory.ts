/*
 * Owns the stable ContextFailure expressions: cancellation, source read
 * failures and the failed result wrapper. Flow owners decide where a failure
 * happens; this module only builds the failure values and never records state.
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
  readonly owner: 'session' | 'workspace' | 'instructions' | 'skills' | 'tools' | 'ai';
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

/** Stable failed result wrapper shared by every Context flow owner. */
export function buildFailedContextResult<T extends ContextFailure>(
  failure: T,
): { readonly status: 'failed'; readonly failure: T } {
  return { status: 'failed', failure };
}
