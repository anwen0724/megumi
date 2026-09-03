/* Defines the Candidate Supply Tool that submits selected Source results to the Candidate Pool. */
import { Type } from '@megumi/ai';
import type { JsonSchemaObject, RawToolResult } from '../tool';
import type { ToolHandler } from '../tool-handler';
import type { BuiltInToolContext } from './workspace-file-access';

export interface SubmitCandidatesOperation {
  submitCandidates(request: {
    readonly executionId: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
  }): Promise<RawToolResult>;
}

export const submitCandidatesToolDefinition = {
  name: 'submit_candidates',
  description: 'Submit Source results that are related to one or more active Interests.',
  promptSnippet: 'Submit related Source results with a grounded content summary and a concrete reason for each Interest match.',
  parameters: Type.Object({
    items: Type.Array(Type.Object({
      resultId: Type.String(),
      contentSummary: Type.String(),
      matches: Type.Array(Type.Object({
        interestId: Type.String(),
        relevance: Type.Union([
          Type.Literal('direct'),
          Type.Literal('adjacent'),
          Type.Literal('exploration'),
        ]),
        matchReason: Type.String(),
      }), { minItems: 1 }),
    }), { minItems: 1, maxItems: 50 }),
  }) as unknown as JsonSchemaObject,
};

/** Creates the thin Tool Handler for Candidate submission. */
export function createSubmitCandidatesToolHandler(
  operation: SubmitCandidatesOperation,
): ToolHandler<BuiltInToolContext> {
  return {
    toolName: 'submit_candidates',
    operations: () => [],
    execute: (_context, invocation, options = {}) => operation.submitCandidates({
      executionId: invocation.executionId,
      input: invocation.input,
      signal: options.signal ?? NEVER_ABORTED_SIGNAL,
    }),
  };
}

const NEVER_ABORTED_SIGNAL = new AbortController().signal;
