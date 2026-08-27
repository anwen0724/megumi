/* Resolves one fixed Daily Recommendation window from authoritative Discovery facts. */
import type { Message } from '@megumi/ai';
import type { InstructionReader, SystemInstructionDocument } from '@megumi/instructions';
import type { ToolDefinition } from '@megumi/tools';
import type { ContextFailure } from '../context';
import type {
  DailyRecommendationContextMaterial,
  DiscoveryFactsReader,
} from '../discovery-context';
import {
  buildCancelledContextFailure,
  buildFailedContextResult,
  buildSourceContextFailure,
} from '../context-failure-factory';

export interface ResolveDailyRecommendationContextRequest {
  readonly kind: 'daily_recommendation';
  readonly executionId: string;
  readonly batchId: string;
  readonly localDate: string;
  readonly currentMessages: readonly Message[];
  readonly tools: readonly ToolDefinition[];
  readonly signal?: AbortSignal;
}

export interface DailyRecommendationResolvedContext {
  readonly kind: 'daily_recommendation';
  readonly localDate: string;
  readonly material: DailyRecommendationContextMaterial;
  readonly currentMessages: readonly Message[];
  readonly systemInstructions: readonly SystemInstructionDocument[];
  readonly tools: readonly ToolDefinition[];
}

export type ResolveDailyRecommendationContextResult =
  | { readonly status: 'resolved'; readonly context: DailyRecommendationResolvedContext }
  | { readonly status: 'failed'; readonly failure: ContextFailure };

export interface DailyRecommendationContextResolver {
  resolve(
    request: ResolveDailyRecommendationContextRequest,
  ): Promise<ResolveDailyRecommendationContextResult>;
}

/** Creates the resolver for an execution-local Daily Recommendation snapshot. */
export function createDailyRecommendationContextResolver(dependencies: {
  readonly instructionReader: InstructionReader;
  readonly factsReader: DiscoveryFactsReader;
}): DailyRecommendationContextResolver {
  return {
    async resolve(request) {
      if (request.signal?.aborted) return cancelledResult();
      const toolProblem = invalidToolDefinitions(request.tools);
      if (toolProblem) {
        return buildFailedContextResult({
          code: 'tool_definitions_invalid',
          message: toolProblem,
          retryable: false,
        });
      }
      try {
        const [systemInstructions, factsResult] = await Promise.all([
          dependencies.instructionReader.getSystemInstructions('daily_recommendation'),
          dependencies.factsReader.readDailyRecommendationFacts({
            executionId: request.executionId,
            batchId: request.batchId,
            localDate: request.localDate,
            signal: request.signal,
          }),
        ]);
        if (request.signal?.aborted) return cancelledResult();
        if (factsResult.status === 'cancelled') return cancelledResult();
        if (factsResult.status === 'failed') {
          return buildFailedContextResult(buildSourceContextFailure({
            code: 'context_build_failed',
            message: factsResult.failure.message,
            retryable: true,
            owner: 'discovery',
            sourceCode: factsResult.failure.code,
          }));
        }
        const facts = factsResult.facts;
        if (facts.batch.batchId !== request.batchId || facts.batch.localDate !== request.localDate) {
          return buildFailedContextResult({
            code: 'context_build_failed',
            message: 'Daily Recommendation facts do not belong to this Batch.',
            retryable: true,
            cause: { owner: 'discovery', code: 'batch_mismatch' },
          });
        }
        const material: DailyRecommendationContextMaterial = {
          batch: facts.batch,
          interests: facts.interests,
          explorationPreference: facts.explorationPreference,
          candidates: facts.candidates,
          recentRecommendations: facts.recentRecommendations.slice(0, 50),
          pendingFeedback: facts.pendingFeedback.slice(0, 20),
          omittedPendingFeedbackCount: facts.omittedPendingFeedbackCount
            + Math.max(0, facts.pendingFeedback.length - 20),
        };
        return {
          status: 'resolved',
          context: {
            kind: 'daily_recommendation',
            localDate: request.localDate,
            material,
            currentMessages: [...request.currentMessages],
            systemInstructions,
            tools: [...request.tools],
          },
        };
      } catch (error) {
        return buildFailedContextResult(buildSourceContextFailure({
          code: 'base_instructions_failed',
          message: error instanceof Error ? error.message : 'Base Instructions could not be read.',
          retryable: true,
          owner: 'instructions',
        }));
      }
    },
  };
}

function cancelledResult(): ResolveDailyRecommendationContextResult {
  return buildFailedContextResult(buildCancelledContextFailure('Context operation was cancelled.'));
}

function invalidToolDefinitions(
  definitions: readonly { name?: unknown; description?: unknown; parameters?: unknown }[],
): string | undefined {
  if (definitions.some((definition) => (
    typeof definition.name !== 'string' || definition.name.length === 0
    || typeof definition.description !== 'string'
    || typeof definition.parameters !== 'object' || definition.parameters === null
  ))) {
    return 'Tool Definitions cannot form a valid Prompt tools list.';
  }
  return undefined;
}
