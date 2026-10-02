/* Defines the structured draft submission tool; the application owns publication. */
import { Type } from '@megumi/ai';
import type { JsonSchemaObject, RawToolResult } from './tool';
import type { ToolHandler } from './tool-handler';
import type { BuiltInToolContext } from './workspace-file-access';

export interface SubmitRecommendationsOperation {
  submitRecommendations(request: {
    readonly executionId: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
  }): Promise<RawToolResult>;
}

export const submitRecommendationsToolDefinition = {
  name: 'submit_recommendations',
  description: 'Submit the complete ordered recommendation draft. An accepted draft ends this run; the application validates and publishes it after successful completion.',
  promptSnippet: 'Submit the final ordered Candidate IDs and one user-facing reason per recommendation.',
  parameters: Type.Object({
    items: Type.Array(Type.Object({
      candidateId: Type.String(),
      recommendationReason: Type.String(),
    }), { minItems: 1, maxItems: 100 }),
  }) as unknown as JsonSchemaObject,
  annotations: { idempotentHint: true, openWorldHint: false },
};

/** Delegates draft validation to the recommendation module without publishing it. */
export function createSubmitRecommendationsToolHandler(
  operation: SubmitRecommendationsOperation,
): ToolHandler<BuiltInToolContext> {
  return {
    toolName: 'submit_recommendations',
    operations: () => [],
    execute: (_context, invocation, options = {}) => operation.submitRecommendations({
      executionId: invocation.executionId,
      input: invocation.input,
      signal: options.signal ?? NEVER_ABORTED_SIGNAL,
    }),
  };
}

const NEVER_ABORTED_SIGNAL = new AbortController().signal;
