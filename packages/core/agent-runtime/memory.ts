import type { ContextSourceRef } from '@megumi/shared/agent-context-contracts';
import type { AgentAction } from '@megumi/shared/agent-lifecycle-contracts';
import type { JsonObject } from '@megumi/shared/json';
import type { MemoryRecallResult } from '@megumi/shared/memory-contracts';

export type MemoryUpdateOperation =
  | 'candidate_proposed'
  | 'candidate_accepted'
  | 'candidate_rejected'
  | 'candidate_archived'
  | 'memory_created'
  | 'memory_updated'
  | 'memory_archived'
  | 'memory_disabled'
  | 'memory_enabled'
  | 'memory_deleted'
  | 'memory_recalled';

export interface MemoryUpdateActionPreviewInput {
  operation: MemoryUpdateOperation;
  candidateId?: string;
  memoryId?: string;
  recallRequestId?: string;
  summary: string;
  sourceRefCount?: number;
}

export function createMemoryUpdateActionInputPreview(input: MemoryUpdateActionPreviewInput): JsonObject {
  return {
    operation: input.operation,
    ...(input.candidateId ? { candidateId: input.candidateId } : {}),
    ...(input.memoryId ? { memoryId: input.memoryId } : {}),
    ...(input.recallRequestId ? { recallRequestId: input.recallRequestId } : {}),
    summary: input.summary,
    ...(input.sourceRefCount !== undefined ? { sourceRefCount: input.sourceRefCount } : {}),
  };
}

export interface CreateMemoryUpdateIntentInput extends MemoryUpdateActionPreviewInput {
  actionId: string;
  runId: string;
  stepId: string;
  requestedAt: string;
}

export function createMemoryUpdateIntent(input: CreateMemoryUpdateIntentInput): AgentAction {
  return {
    actionId: input.actionId,
    runId: input.runId,
    stepId: input.stepId,
    kind: 'update_memory',
    status: 'requested',
    requestedAt: input.requestedAt,
    inputPreview: createMemoryUpdateActionInputPreview(input),
  };
}

export function selectMemoryRecallIdsForContext(results: MemoryRecallResult[]): string[] {
  return results.filter((result) => result.selectedForContext).map((result) => result.recallResultId);
}

export function createMemoryRecallContextSource(result: MemoryRecallResult, loadedAt: string): ContextSourceRef {
  return {
    sourceId: `context-source:${result.recallResultId}`,
    sourceKind: 'memory_recall',
    sourceUri: `memory://${result.memoryId}`,
    loadedAt,
    freshness: 'fresh',
    redactionState: 'redacted',
    selectionReason: 'memory_recall',
    metadata: {
      recallResultId: result.recallResultId,
      recallRequestId: result.recallRequestId,
      memoryId: result.memoryId,
      scope: result.scope,
      kind: result.kind,
      recallReason: result.recallReason,
      tokenEstimate: result.tokenEstimate,
    },
  };
}
