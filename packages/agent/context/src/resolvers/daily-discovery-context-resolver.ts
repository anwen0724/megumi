/* Resolves process-local daily-discovery prompt facts without reading Session or Workspace state. */
import type { Message } from '@megumi/ai';
import type { InstructionReader, SystemInstructionDocument } from '@megumi/instructions';
import type { ToolDefinition } from '@megumi/tools';
import type { ContextFailure, DailyDiscoveryContextMaterial } from '../context';
import {
  buildCancelledContextFailure,
  buildFailedContextResult,
  buildSourceContextFailure,
} from '../context-failure-factory';

export interface ResolveDailyDiscoveryContextRequest {
  readonly kind: 'daily_discovery';
  readonly localDate: string;
  readonly material: DailyDiscoveryContextMaterial;
  readonly currentMessages: readonly Message[];
  readonly tools: readonly ToolDefinition[];
  readonly signal?: AbortSignal;
}

export interface DailyDiscoveryResolvedContext {
  readonly kind: 'daily_discovery';
  readonly localDate: string;
  readonly material: DailyDiscoveryContextMaterial;
  readonly currentMessages: readonly Message[];
  readonly systemInstructions: readonly SystemInstructionDocument[];
  readonly tools: readonly ToolDefinition[];
}

export type ResolveDailyDiscoveryContextResult =
  | { readonly status: 'resolved'; readonly context: DailyDiscoveryResolvedContext }
  | { readonly status: 'failed'; readonly failure: ContextFailure };

export interface DailyDiscoveryContextResolver {
  resolve(request: ResolveDailyDiscoveryContextRequest): Promise<ResolveDailyDiscoveryContextResult>;
}

export function createDailyDiscoveryContextResolver(dependencies: {
  readonly instructionReader: InstructionReader;
}): DailyDiscoveryContextResolver {
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
          .getSystemInstructions('daily_discovery');
        if (request.signal?.aborted) return cancelledResult();
        return {
          status: 'resolved',
          context: {
            kind: 'daily_discovery',
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

function cancelledResult(): ResolveDailyDiscoveryContextResult {
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
