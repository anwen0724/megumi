/* Defines Daily Recommendation's terminal typed publication Tool. */
import { Type } from '@megumi/ai';
import type { JsonSchemaObject, RawToolResult } from '../tool';
import type { ToolHandler } from '../tool-handler';
import type { BuiltInToolContext } from './workspace-file-access';

export interface PublishDailyRecommendationsOperation {
  publishDailyRecommendations(request: {
    readonly executionId: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
  }): Promise<RawToolResult>;
}

export const publishDailyRecommendationsToolDefinition = {
  name: 'publish_daily_recommendations',
  description: 'Publish the complete ordered Daily Recommendation selection atomically.',
  promptSnippet: 'Publish the final ordered Candidate IDs and one user-facing reason per Recommendation.',
  parameters: Type.Object({
    items: Type.Array(Type.Object({
      candidateId: Type.String(),
      recommendationReason: Type.String(),
    }), { minItems: 1, maxItems: 100 }),
  }) as unknown as JsonSchemaObject,
  annotations: { idempotentHint: true, openWorldHint: false },
};

/** Creates the thin Tool Handler that delegates publication to the Daily Recommendation Owner. */
export function createPublishDailyRecommendationsToolHandler(
  operation: PublishDailyRecommendationsOperation,
): ToolHandler<BuiltInToolContext> {
  return {
    toolName: 'publish_daily_recommendations',
    operations: () => [],
    execute: (_context, invocation, options = {}) => operation.publishDailyRecommendations({
      executionId: invocation.executionId,
      input: invocation.input,
      signal: options.signal ?? NEVER_ABORTED_SIGNAL,
    }),
  };
}

const NEVER_ABORTED_SIGNAL = new AbortController().signal;

