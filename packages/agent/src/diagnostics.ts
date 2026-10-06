/*
 * Reports diagnostic and observer failures without changing execution outcomes.
 */
import type { SimpleStreamOptions } from '@megumi/ai';

export interface DiagnosticScope {
  readonly runId: string;
  readonly name:
    | 'agent.execution'
    | 'context.build'
    | 'context.compact'
    | 'model.call'
    | 'tool.call'
    | 'permission.await';
  readonly modelCallId?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
}

export type DiagnosticOutcome =
  | { readonly status: 'ok' | 'cancelled' }
  | { readonly status: 'error'; readonly code: string; readonly message: string };

export interface ModelCapture {
  readonly options: Pick<
    SimpleStreamOptions,
    'fetch' | 'onProviderExchange'
  >;
}

export interface AgentDiagnostics {
  observe?<T>(
    scope: DiagnosticScope,
    operation: () => Promise<T>,
    classify?: (result: T) => DiagnosticOutcome,
  ): Promise<T>;
  content?(input: {
    readonly runId: string;
    readonly modelCallId?: string;
    readonly toolCallId?: string;
    readonly kind:
      | 'context.resolved'
      | 'prompt.final'
      | 'model.request'
      | 'model.response'
      | 'tool.arguments'
      | 'tool.handler_result'
      | 'tool.result';
    readonly value: unknown;
  }): void;
  modelCapture?(scope: DiagnosticScope): ModelCapture;
  report(input: { readonly runId: string; readonly error: unknown }): void;
}

/** Diagnostics are observational; their own failure must not break required work. */
export function reportDiagnostic(
  diagnostics: AgentDiagnostics | undefined,
  runId: string,
  error: unknown,
): void {
  try {
    if (diagnostics) diagnostics.report({ runId, error });
    else console.error('Agent diagnostic', runId, error);
  } catch (diagnosticError) {
    console.error('Agent diagnostic reporting failed', runId, diagnosticError);
  }
}

/** A failed observer cannot skip or repeat the operation it surrounds. */
export async function observeOperation<T>(
  diagnostics: AgentDiagnostics | undefined,
  scope: DiagnosticScope,
  operation: () => Promise<T>,
  classify?: (result: T) => DiagnosticOutcome,
): Promise<T> {
  if (!diagnostics?.observe) return operation();
  let result: Promise<T> | undefined;
  const once = () => (result ??= Promise.resolve().then(operation));
  try {
    await diagnostics.observe(scope, once, classify);
  } catch (error) {
    reportDiagnostic(diagnostics, scope.runId, error);
  }
  return once();
}

export function captureContent(
  diagnostics: AgentDiagnostics | undefined,
  input: Parameters<NonNullable<AgentDiagnostics['content']>>[0],
): void {
  try {
    diagnostics?.content?.(input);
  } catch (error) {
    reportDiagnostic(diagnostics, input.runId, error);
  }
}

export function createModelCapture(
  diagnostics: AgentDiagnostics | undefined,
  scope: DiagnosticScope,
): ModelCapture | undefined {
  try {
    return diagnostics?.modelCapture?.(scope);
  } catch (error) {
    reportDiagnostic(diagnostics, scope.runId, error);
    return undefined;
  }
}
