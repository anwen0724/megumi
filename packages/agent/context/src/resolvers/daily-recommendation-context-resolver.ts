/* Resolves fixed Daily Recommendation Pool facts without reading Session, Workspace, Source, or Search state. */
import type { Message } from '@megumi/ai';
import type { InstructionReader, SystemInstructionDocument } from '@megumi/instructions';
import type { ToolDefinition } from '@megumi/tools';
import type { ContextFailure, DailyRecommendationContextMaterial } from '../context';
import {
  buildCancelledContextFailure,
  buildFailedContextResult,
  buildSourceContextFailure,
} from '../context-failure-factory';

export interface ResolveDailyRecommendationContextRequest {
  readonly kind: 'daily_recommendation';
  readonly localDate: string;
  readonly material: DailyRecommendationContextMaterial;
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
        const systemInstructions = await dependencies.instructionReader
          .getSystemInstructions('daily_recommendation');
        if (request.signal?.aborted) return cancelledResult();
        return {
          status: 'resolved',
          context: {
            kind: 'daily_recommendation',
            localDate: request.localDate,
            material: request.material,
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
