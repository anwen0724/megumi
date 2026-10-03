/*
 * Reports diagnostic and observer failures without changing execution outcomes.
 */
export interface AgentDiagnostics {
  report(input: { readonly runId: string; readonly error: unknown }): void;
}

/** Diagnostics are observational; their own failure must not break required work. */
export function reportDiagnostic(diagnostics: AgentDiagnostics | undefined, runId: string, error: unknown): void {
  try {
    if (diagnostics) diagnostics.report({ runId, error });
    else console.error('Agent diagnostic', runId, error);
  } catch (diagnosticError) {
    console.error('Agent diagnostic reporting failed', runId, diagnosticError);
  }
}
