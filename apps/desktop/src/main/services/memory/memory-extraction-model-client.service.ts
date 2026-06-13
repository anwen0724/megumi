// Adapts memory extraction prompts to hidden model-step requests.
// The provider sees a normal ModelStepRuntimeRequest; memory persistence stays in host services.
import type { MemoryExtractionPrompt } from '@megumi/memory';
import type { AiModelStepCompletionResult } from '@megumi/ai/types';
import type { ModelInputContext, ModelInputContextPart } from '@megumi/shared/model';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { ProviderId } from '@megumi/shared/provider';

export interface MemoryExtractionModelStepProvider {
  completeModelStep(request: ModelStepRuntimeRequest): Promise<AiModelStepCompletionResult>;
}

export interface ExtractMemoryCandidatesInput {
  runId: string;
  sessionId: string;
  projectId?: string | null;
  providerId?: ProviderId | null;
  modelId?: string | null;
  prompt: MemoryExtractionPrompt;
  signal?: AbortSignal;
}

export interface MemoryExtractionModelClientServiceOptions {
  modelStepProvider: MemoryExtractionModelStepProvider;
  clock: { now(): string };
  ids: {
    requestId(): string;
    contextId(): string;
    traceId(): string;
  };
}

export class MemoryExtractionModelClientService {
  constructor(private readonly options: MemoryExtractionModelClientServiceOptions) {}

  async extractMemoryCandidates(input: ExtractMemoryCandidatesInput): Promise<
    | { ok: true; text: string }
    | { ok: false; reason: string }
  > {
    if (!input.providerId || !input.modelId) {
      return { ok: false, reason: 'missing_provider_target' };
    }

    const request = this.buildRequest(input);

    try {
      const completion = await this.options.modelStepProvider.completeModelStep(request);
      if (input.signal?.aborted) {
        return { ok: false, reason: 'request_cancelled' };
      }
      if (!completion.ok) {
        return { ok: false, reason: completion.error.code || completion.error.message || 'provider_failed' };
      }
      const completed = completion.text.trim();
      if (!completed) {
        return { ok: false, reason: 'empty_extraction_output' };
      }
      return { ok: true, text: completed };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private buildRequest(input: ExtractMemoryCandidatesInput): ModelStepRuntimeRequest {
    const stepId = `memory-extraction:${input.runId}`;
    const createdAt = this.options.clock.now();
    return {
      requestId: this.options.ids.requestId(),
      sessionId: input.sessionId,
      runId: input.runId,
      stepId,
      providerId: input.providerId as ProviderId,
      modelId: input.modelId as string,
      inputContext: buildExtractionInputContext({
        contextId: this.options.ids.contextId(),
        traceId: this.options.ids.traceId(),
        sessionId: input.sessionId,
        runId: input.runId,
        stepId,
        projectId: input.projectId ?? null,
        prompt: input.prompt,
        builtAt: createdAt,
      }),
      createdAt,
    };
  }
}

function buildExtractionInputContext(input: {
  contextId: string;
  traceId: string;
  sessionId: string;
  runId: string;
  stepId: string;
  projectId?: string | null;
  prompt: MemoryExtractionPrompt;
  builtAt: string;
}): ModelInputContext {
  const systemSourceRef = {
    sourceId: `${input.contextId}:system`,
    sourceKind: 'runtime_fact' as const,
    loadedAt: input.builtAt,
    metadata: { purpose: 'memory_extraction' },
  };
  const userSourceRef = {
    sourceId: `${input.contextId}:candidate-input`,
    sourceKind: 'runtime_fact' as const,
    loadedAt: input.builtAt,
    metadata: { purpose: 'memory_extraction_input' },
  };
  const parts: ModelInputContextPart[] = [
    {
      partId: `${input.contextId}:system-part`,
      kind: 'instruction',
      instructionKind: 'system',
      text: input.prompt.system,
      sourceRefs: [systemSourceRef],
      priority: 100,
      tokenEstimate: estimateTokens(input.prompt.system),
      budgetStatus: 'included_full',
      budgetClass: 'required',
      required: true,
      metadata: { purpose: 'memory_extraction' },
    },
    {
      partId: `${input.contextId}:user-part`,
      kind: 'current_turn',
      role: 'user',
      text: input.prompt.user,
      sourceRefs: [userSourceRef],
      priority: 100,
      tokenEstimate: estimateTokens(input.prompt.user),
      budgetStatus: 'included_full',
      budgetClass: 'required',
      required: true,
      metadata: { purpose: 'memory_extraction_input' },
    },
  ];
  const inputTokenEstimate = parts.reduce((sum, part) => sum + (part.tokenEstimate ?? 0), 0);
  return {
    contextId: input.contextId,
    sessionId: input.sessionId,
    runId: input.runId,
    stepId: input.stepId,
    parts,
    budget: {
      modelContextWindow: 8192,
      reservedOutputTokens: 1024,
      availableInputTokens: 7168,
      keepRecentTokens: 7168,
      inputTokenEstimate,
      partBudgets: parts.map((part) => ({
        partId: part.partId,
        tokenEstimate: part.tokenEstimate ?? 0,
        budgetStatus: part.budgetStatus,
      })),
    },
    trace: {
      buildReason: 'memory_extraction',
      selectedSources: [
        {
          sourceId: systemSourceRef.sourceId,
          sourceKind: systemSourceRef.sourceKind,
          reason: 'memory_extraction_system_prompt',
          budgetClass: 'required',
          partId: parts[0].partId,
        },
        {
          sourceId: userSourceRef.sourceId,
          sourceKind: userSourceRef.sourceKind,
          reason: 'memory_extraction_candidate_input',
          budgetClass: 'required',
          partId: parts[1].partId,
        },
      ],
      excludedSources: [],
      metadata: {
        traceId: input.traceId,
        projectId: input.projectId ?? null,
        hidden: true,
      },
    },
    builtAt: input.builtAt,
  };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
