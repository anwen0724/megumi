/* Defines Recommendation's deterministic next-page working-set expansion Tool. */
import { Type } from '@megumi/ai';
import type { JsonSchemaObject, RawToolResult } from '../tool';
import type { ToolHandler } from '../tool-handler';
import type { BuiltInToolContext } from './workspace-file-access';

export interface ExpandRecommendationWorkingSetOperation {
  expandRecommendationWorkingSet(request: {
    readonly executionId: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
  }): Promise<RawToolResult>;
}

export const expandRecommendationWorkingSetToolDefinition = {
  name: 'expand_recommendation_working_set',
  description: 'Expose the next deterministic segment of the frozen Recommendation ranking.',
  promptSnippet: 'Expand the working set only when more frozen Candidates are needed for comparison.',
  parameters: Type.Object({}) as unknown as JsonSchemaObject,
  annotations: { readOnlyHint: true, openWorldHint: false },
};

/** Creates the thin Tool Handler for execution-local working-set expansion. */
export function createExpandRecommendationWorkingSetToolHandler(
  operation: ExpandRecommendationWorkingSetOperation,
): ToolHandler<BuiltInToolContext> {
  return {
    toolName: 'expand_recommendation_working_set',
    operations: () => [],
    execute: (_context, invocation, options = {}) => operation.expandRecommendationWorkingSet({
      executionId: invocation.executionId,
      input: invocation.input,
      signal: options.signal ?? NEVER_ABORTED_SIGNAL,
    }),
  };
}

const NEVER_ABORTED_SIGNAL = new AbortController().signal;
