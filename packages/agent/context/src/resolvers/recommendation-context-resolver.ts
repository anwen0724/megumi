/* Resolves one fixed Recommendation working set from authoritative execution facts. */
import type { Message } from '@megumi/ai';
import type { InstructionReader, SystemInstructionDocument } from '@megumi/instructions';
import type { ToolDefinition } from '@megumi/tools';
import type { ContextFailure } from '../context';
import type {
  RecommendationContextMaterial,
  RecommendationFacts,
  DiscoveryFactsReader,
} from '../discovery-context-types';
import {
  buildCancelledContextFailure,
  buildFailedContextResult,
  buildSourceContextFailure,
} from '../context-failure-factory';

export interface ResolveRecommendationContextRequest {
  readonly kind: 'recommendation';
  readonly executionId: string;
  readonly requestId: string;
  readonly localDate: string;
  readonly currentMessages: readonly Message[];
  readonly tools: readonly ToolDefinition[];
  readonly signal?: AbortSignal;
}

export interface RecommendationResolvedContext {
  readonly kind: 'recommendation';
  readonly localDate: string;
  readonly material: RecommendationContextMaterial;
  /** Complete objective ranking evidence recorded with Context but excluded from the Prompt. */
  readonly ranking: RecommendationFacts['ranking'];
  readonly currentMessages: readonly Message[];
  readonly systemInstructions: readonly SystemInstructionDocument[];
  readonly tools: readonly ToolDefinition[];
}

export type ResolveRecommendationContextResult =
  | { readonly status: 'resolved'; readonly context: RecommendationResolvedContext }
  | { readonly status: 'failed'; readonly failure: ContextFailure };

export interface RecommendationContextResolver {
  resolve(
    request: ResolveRecommendationContextRequest,
  ): Promise<ResolveRecommendationContextResult>;
}

/** Creates the resolver for an execution-local Recommendation snapshot. */
export function createRecommendationContextResolver(dependencies: {
  readonly instructionReader: InstructionReader;
  readonly factsReader: DiscoveryFactsReader;
}): RecommendationContextResolver {
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
          dependencies.instructionReader.getSystemInstructions('recommendation'),
          dependencies.factsReader.readRecommendationFacts({
            executionId: request.executionId,
            requestId: request.requestId,
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
        if (facts.execution.requestId !== request.requestId
          || facts.execution.localDate !== request.localDate) {
          return buildFailedContextResult({
            code: 'context_build_failed',
            message: 'Recommendation facts do not belong to this execution.',
            retryable: true,
            cause: { owner: 'discovery', code: 'execution_mismatch' },
          });
        }
        const material: RecommendationContextMaterial = {
          execution: facts.execution,
          interests: facts.interests,
          preferences: facts.preferences,
          candidates: facts.candidates,
          recentRecommendations: facts.recentRecommendations.slice(0, 50),
        };
        return {
          status: 'resolved',
          context: {
            kind: 'recommendation',
            localDate: request.localDate,
            material,
            ranking: facts.ranking,
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

function cancelledResult(): ResolveRecommendationContextResult {
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
