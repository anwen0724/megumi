/* Owns one Sandbox scope lifecycle around a caller-provided execution. */
import type { OpenSandboxRequest, Sandbox, SandboxScope } from './sandbox';

export type SandboxScopeExecutionResult<T> =
  | { readonly status: 'completed'; readonly value: T }
  | { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'termination_unconfirmed'; readonly value: T };

export async function executeSandboxScope<T>(request: {
  readonly sandbox: Sandbox;
  readonly open: OpenSandboxRequest;
  readonly execute: (scope: SandboxScope) => Promise<T>;
}): Promise<SandboxScopeExecutionResult<T>> {
  const opened = await request.sandbox.open(request.open);
  if (opened.status === 'unavailable') return opened;
  let value: T;
  try {
    value = await request.execute(opened.scope);
  } catch (error) {
    await opened.scope.close();
    throw error;
  }
  const closed = await opened.scope.close();
  return closed.status === 'termination_unconfirmed'
    ? { status: 'termination_unconfirmed', value }
    : { status: 'completed', value };
}