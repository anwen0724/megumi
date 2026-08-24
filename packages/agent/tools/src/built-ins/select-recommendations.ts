/* Defines the ordinary built-in tool that freezes selection in the active Discovery attempt. */
import { Type } from '@megumi/ai';
import type { JsonSchemaObject, RawToolResult } from '../tool';
import type { ToolHandler } from '../tool-handler';
import type { BuiltInToolContext } from './workspace-file-access';

export interface SelectRecommendationsOperation {
  selectRecommendations(request: {
    readonly executionId: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
  }): Promise<RawToolResult>;
}

export const selectRecommendationsToolDefinition = {
  name: 'select_recommendations',
  description: 'Freeze the ordered Recommendation selection for this execution.',
  promptSnippet: 'Commit the first valid ordered recommendation selection for this execution.',
  parameters: Type.Object({
    items: Type.Array(Type.Object({
      candidateId: Type.String(),
      recommendationReason: Type.String(),
    })),
  }) as unknown as JsonSchemaObject,
};

export function createSelectRecommendationsToolHandler(
  operation: SelectRecommendationsOperation,
): ToolHandler<BuiltInToolContext> {
  return {
    toolName: 'select_recommendations',
    operations: () => [],
    execute: (_context, invocation, options = {}) => operation.selectRecommendations({
      executionId: invocation.executionId,
      input: invocation.input,
      signal: options.signal ?? NEVER_ABORTED_SIGNAL,
    }),
  };
}

const NEVER_ABORTED_SIGNAL = new AbortController().signal;
