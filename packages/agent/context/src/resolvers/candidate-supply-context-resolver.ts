/* Resolves the fixed Candidate Supply snapshot without reading live product state. */
import type { Message } from '@megumi/ai';
import type { InstructionReader, SystemInstructionDocument } from '@megumi/instructions';
import type { ToolDefinition } from '@megumi/tools';
import type { CandidateSupplyContextMaterial, ContextFailure } from '../context';
import {
  buildCancelledContextFailure,
  buildFailedContextResult,
  buildSourceContextFailure,
} from '../context-failure-factory';

export interface ResolveCandidateSupplyContextRequest {
  readonly kind: 'candidate_supply';
  readonly startedAt: string;
  readonly material: CandidateSupplyContextMaterial;
  readonly currentMessages: readonly Message[];
  readonly tools: readonly ToolDefinition[];
  readonly signal?: AbortSignal;
}

export interface CandidateSupplyResolvedContext {
  readonly kind: 'candidate_supply';
  readonly startedAt: string;
  readonly material: CandidateSupplyContextMaterial;
  readonly currentMessages: readonly Message[];
  readonly systemInstructions: readonly SystemInstructionDocument[];
  readonly tools: readonly ToolDefinition[];
}

export type ResolveCandidateSupplyContextResult =
  | { readonly status: 'resolved'; readonly context: CandidateSupplyResolvedContext }
  | { readonly status: 'failed'; readonly failure: ContextFailure };

export function createCandidateSupplyContextResolver(dependencies: {
  readonly instructionReader: InstructionReader;
}) {
  return {
    async resolve(
      request: ResolveCandidateSupplyContextRequest,
    ): Promise<ResolveCandidateSupplyContextResult> {
      if (request.signal?.aborted) return cancelledResult();
      if (request.tools.some((tool) => !tool.name || !tool.description || !tool.parameters)) {
        return buildFailedContextResult({
          code: 'tool_definitions_invalid',
          message: 'Tool Definitions cannot form a valid Candidate Supply Prompt.',
          retryable: false,
        });
      }
      try {
        const systemInstructions = await dependencies.instructionReader
          .getSystemInstructions('candidate_supply');
        if (request.signal?.aborted) return cancelledResult();
        return {
          status: 'resolved',
          context: {
            kind: 'candidate_supply',
            startedAt: request.startedAt,
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

function cancelledResult(): ResolveCandidateSupplyContextResult {
  return buildFailedContextResult(buildCancelledContextFailure('Context operation was cancelled.'));
}
