/* Resolves one Preference Learning batch without exposing unrelated Discovery state. */
import type { Message } from '@megumi/ai';
import type { InstructionReader, SystemInstructionDocument } from '@megumi/instructions';
import type { ContextFailure } from '../context';
import type {
  DiscoveryFactsReader,
  PreferenceLearningContextMaterial,
} from '../discovery-context';
import {
  buildCancelledContextFailure,
  buildFailedContextResult,
  buildSourceContextFailure,
} from '../context-failure-factory';

export interface ResolvePreferenceLearningContextRequest {
  readonly kind: 'preference_learning';
  readonly batchId: string;
  readonly startedAt: string;
  readonly currentMessages: readonly Message[];
  readonly signal?: AbortSignal;
}

export interface PreferenceLearningResolvedContext {
  readonly kind: 'preference_learning';
  readonly batchId: string;
  readonly startedAt: string;
  readonly material: PreferenceLearningContextMaterial;
  readonly currentMessages: readonly Message[];
  readonly systemInstructions: readonly SystemInstructionDocument[];
  readonly tools: readonly [];
}

export type ResolvePreferenceLearningContextResult =
  | { readonly status: 'resolved'; readonly context: PreferenceLearningResolvedContext }
  | { readonly status: 'failed'; readonly failure: ContextFailure };

/** Creates the Resolver for ordinary, Tool-free Preference Learning completions. */
export function createPreferenceLearningContextResolver(dependencies: {
  readonly instructionReader: InstructionReader;
  readonly factsReader: DiscoveryFactsReader;
}) {
  return {
    async resolve(
      request: ResolvePreferenceLearningContextRequest,
    ): Promise<ResolvePreferenceLearningContextResult> {
      if (request.signal?.aborted) return cancelled();
      try {
        const [systemInstructions, factsResult] = await Promise.all([
          dependencies.instructionReader.getSystemInstructions('preference_learning'),
          dependencies.factsReader.readPreferenceLearningFacts({
            batchId: request.batchId,
            signal: request.signal,
          }),
        ]);
        if (request.signal?.aborted || factsResult.status === 'cancelled') return cancelled();
        if (factsResult.status === 'failed') {
          return buildFailedContextResult(buildSourceContextFailure({
            code: 'context_build_failed',
            message: factsResult.failure.message,
            retryable: true,
            owner: 'discovery',
            sourceCode: factsResult.failure.code,
          }));
        }
        if (factsResult.facts.batch.batchId !== request.batchId) {
          return buildFailedContextResult({
            code: 'context_build_failed',
            message: 'Preference Learning facts do not belong to this Batch.',
            retryable: true,
            cause: { owner: 'discovery', code: 'batch_mismatch' },
          });
        }
        return {
          status: 'resolved',
          context: {
            kind: 'preference_learning',
            batchId: request.batchId,
            startedAt: request.startedAt,
            material: {
              batch: factsResult.facts.batch,
              interests: factsResult.facts.interests,
              currentPreferences: factsResult.facts.currentPreferences,
              feedbackChanges: factsResult.facts.feedbackChanges,
            },
            currentMessages: [...request.currentMessages],
            systemInstructions,
            tools: [],
          },
        };
      } catch (error) {
        return buildFailedContextResult(buildSourceContextFailure({
          code: 'base_instructions_failed',
          message: error instanceof Error ? error.message : 'Preference Learning Context could not be read.',
          retryable: true,
          owner: 'instructions',
        }));
      }
    },
  };
}

function cancelled(): ResolvePreferenceLearningContextResult {
  return buildFailedContextResult(buildCancelledContextFailure('Context operation was cancelled.'));
}
