/*
 * Verifies the public Context v2 domain models and single service contract.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { ContentBlock, ConversationItem, ToolSetEntry } from '@megumi/ai';
import type { SkillCatalogItem } from '@megumi/agent/skills/domain/dto/context/skill-context-response';
import type {
  ActiveContext,
  CompactSessionRequest,
  CompactSessionResult,
  ContextCapacity,
  ContextPolicy,
  ContextService,
  ContextSourceRef,
  ContextUsage,
  ConversationTurn,
  CurrentConversationTurn,
  GetSessionUsageSnapshotRequest,
  GetSessionUsageSnapshotResult,
  PrepareModelCallRequest,
  PrepareModelCallResult,
  PreparedModelCall,
  Prompt,
  PromptInstructions,
  PromptReferenceContext,
  RecordCompletedRunUsageRequest,
  RecordCompletedRunUsageResult,
  SessionUsageSnapshot,
} from '@megumi/agent/context';

describe('Context v2 public domain', () => {
  it('defines the single ContextService contract', () => {
    expectTypeOf<ContextService>().toMatchTypeOf<{
      prepareModelCall(request: PrepareModelCallRequest): Promise<PrepareModelCallResult>;
      compactSession(request: CompactSessionRequest): Promise<CompactSessionResult>;
      recordCompletedRunUsage(request: RecordCompletedRunUsageRequest): RecordCompletedRunUsageResult;
      getSessionUsageSnapshot(request: GetSessionUsageSnapshotRequest): GetSessionUsageSnapshotResult;
    }>();
  });

  it('keeps active context and prompt provider neutral', () => {
    expectTypeOf<ActiveContext>().toEqualTypeOf<{
      sessionId: string;
      instructions: PromptInstructions;
      referenceContext: PromptReferenceContext;
      historicalTurns: ConversationTurn[];
      currentTurn: CurrentConversationTurn;
      tools: ToolSetEntry[];
    }>();
    expectTypeOf<Prompt>().toEqualTypeOf<{
      instructions: PromptInstructions;
      referenceContext: PromptReferenceContext;
      conversation: ConversationItem[];
      tools: ToolSetEntry[];
    }>();
    expectTypeOf<PromptReferenceContext['skillCatalog']>().toEqualTypeOf<SkillCatalogItem[]>();
    expectTypeOf<NonNullable<PromptReferenceContext['memoryRecall']>['items'][number]['content']>()
      .toEqualTypeOf<ContentBlock[]>();
  });

  it('defines prepared calls, capacity, usage, and snapshots', () => {
    expectTypeOf<PreparedModelCall>().toEqualTypeOf<{
      preparationId: string;
      prompt: Prompt;
      usage: ContextUsage;
      sourceRefs: ContextSourceRef[];
      compaction?: { compactionId: string };
    }>();
    expectTypeOf<ContextCapacity>().toEqualTypeOf<{
      providerId: string;
      modelId: string;
      contextWindowTokens: number;
    }>();
    expectTypeOf<ContextPolicy>().toEqualTypeOf<{
      compactionThresholdRatio: number;
      keepRecentTurns: number;
    }>();
    expectTypeOf<ContextUsage>().toEqualTypeOf<{
      usedTokens: number;
      contextWindowTokens: number;
      remainingTokens: number;
      usedRatio: number;
      compactionThresholdRatio: number;
    }>();
    expectTypeOf<SessionUsageSnapshot>().toEqualTypeOf<{
      sessionId: string;
      runId: string;
      providerId: string;
      modelId: string;
      usage: ContextUsage;
      accuracy: 'provider_reported' | 'estimated';
      calculatedAt: string;
    }>();
  });

  it('requires completed run usage inputs at the service boundary', () => {
    expectTypeOf<RecordCompletedRunUsageRequest>().toEqualTypeOf<{
      sessionId: string;
      runId: string;
      modelContext: ContextCapacity;
      preCallUsage: ContextUsage;
      providerInputTokens?: number;
    }>();
  });
});
