/* Resolves bounded Candidate Supply material from authoritative Discovery facts and Source capabilities. */
import type { Message } from '@megumi/ai';
import type { InstructionReader, SystemInstructionDocument } from '@megumi/instructions';
import type { ToolDefinition } from '@megumi/tools';
import type { ContextFailure } from '../context';
import type {
  CandidateSupplyContextMaterial,
  ContextDiscoverySourceRegistry,
  DiscoveryFactsReader,
} from '../discovery-context';
import {
  buildCancelledContextFailure,
  buildFailedContextResult,
  buildSourceContextFailure,
} from '../context-failure-factory';

export interface ResolveCandidateSupplyContextRequest {
  readonly kind: 'candidate_supply';
  readonly executionId: string;
  readonly startedAt: string;
  readonly trigger: string;
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
  readonly factsReader: DiscoveryFactsReader;
  readonly sourceRegistry: ContextDiscoverySourceRegistry;
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
        const [systemInstructions, factsResult] = await Promise.all([
          dependencies.instructionReader.getSystemInstructions('candidate_supply'),
          dependencies.factsReader.readCandidateSupplyFacts({
            executionId: request.executionId,
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
        if (factsResult.facts.executionId !== request.executionId) {
          return buildFailedContextResult({
            code: 'context_build_failed',
            message: 'Candidate Supply facts do not belong to this execution.',
            retryable: true,
            cause: { owner: 'discovery', code: 'execution_mismatch' },
          });
        }
        const items = factsResult.facts.pendingCandidates.slice(0, 50).map((item) => ({
          ...item,
          potentialDuplicates: item.potentialDuplicates.slice(0, 10),
        }));
        const material: CandidateSupplyContextMaterial = {
          execution: { startedAt: request.startedAt, trigger: request.trigger },
          pool: factsResult.facts.pool,
          interests: factsResult.facts.interests,
          explorationPreference: factsResult.facts.explorationPreference,
          negativeConstraints: factsResult.facts.negativeConstraints,
          sources: dependencies.sourceRegistry.listContextSources({
            executionId: request.executionId,
            at: factsResult.facts.asOf,
          }),
          recentQueryOutcomes: factsResult.facts.recentQueryOutcomes.slice(0, 50),
          pendingAdmissionBatch: {
            items,
            totalCount: factsResult.facts.pendingCandidates.length,
            truncated: items.length < factsResult.facts.pendingCandidates.length,
          },
          remainingBudget: factsResult.facts.budget,
        };
        return {
          status: 'resolved',
          context: {
            kind: 'candidate_supply',
            startedAt: request.startedAt,
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

function cancelledResult(): ResolveCandidateSupplyContextResult {
  return buildFailedContextResult(buildCancelledContextFailure('Context operation was cancelled.'));
}
