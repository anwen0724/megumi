/* Owns transient Session usage snapshots and provider-reported usage reconciliation. */
import type { Api, Model } from '@megumi/ai';
import {
  contextCapacityFromModel,
  type ContextCapacity,
  type ContextPolicy,
} from './context-policy';

export interface ContextUsage {
  readonly usedTokens: number;
  readonly contextWindowTokens: number;
  readonly remainingTokens: number;
  readonly usedRatio: number;
  readonly compactionThresholdRatio: number;
}

export interface SessionContextUsageSnapshot {
  readonly sessionId: string;
  readonly runId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly usage: ContextUsage;
  readonly accuracy: 'provider_reported' | 'estimated';
  readonly calculatedAt: string;
}

export interface GetSessionContextUsageRequest {
  readonly sessionId: string;
}

export type GetSessionContextUsageResult =
  | { readonly status: 'available'; readonly snapshot: SessionContextUsageSnapshot }
  | { readonly status: 'not_available' };

export interface RecordCompletedModelCallUsageRequest {
  readonly sessionId: string;
  readonly runId: string;
  readonly model: Model<Api>;
  readonly preCallUsage: ContextUsage;
  readonly providerInputTokens?: number;
}

export type RecordCompletedModelCallUsageResult =
  | { readonly status: 'recorded'; readonly snapshot: SessionContextUsageSnapshot }
  | {
      readonly status: 'failed';
      readonly failure: {
        readonly code: 'usage_snapshot_invalid';
        readonly message: string;
        readonly retryable: false;
      };
    };

export interface ContextUsageReader {
  getSessionUsage(request: GetSessionContextUsageRequest): GetSessionContextUsageResult;
}

export interface ContextUsageRecorder {
  recordCompletedModelCall(
    request: RecordCompletedModelCallUsageRequest,
  ): RecordCompletedModelCallUsageResult;
}

export interface ContextUsageSnapshotCache {
  get(sessionId: string): SessionContextUsageSnapshot | undefined;
  set(sessionId: string, snapshot: SessionContextUsageSnapshot): void;
}

export function calculateContextUsage(input: {
  readonly inputTokens: number;
  readonly capacity: ContextCapacity;
  readonly policy: ContextPolicy;
}): ContextUsage {
  if (!Number.isInteger(input.inputTokens) || input.inputTokens < 0) {
    throw new RangeError('inputTokens must be a nonnegative integer.');
  }
  if (!Number.isInteger(input.capacity.contextWindowTokens) || input.capacity.contextWindowTokens <= 0) {
    throw new RangeError('contextWindowTokens must be a positive integer.');
  }
  if (
    !Number.isFinite(input.policy.compactionThresholdRatio)
    || input.policy.compactionThresholdRatio <= 0
    || input.policy.compactionThresholdRatio >= 1
  ) {
    throw new RangeError('compactionThresholdRatio must be greater than 0 and less than 1.');
  }
  if (!Number.isInteger(input.policy.keepRecentRuns) || input.policy.keepRecentRuns < 0) {
    throw new RangeError('keepRecentRuns must be a nonnegative integer.');
  }
  return Object.freeze({
    usedTokens: input.inputTokens,
    contextWindowTokens: input.capacity.contextWindowTokens,
    remainingTokens: input.capacity.contextWindowTokens - input.inputTokens,
    usedRatio: input.inputTokens / input.capacity.contextWindowTokens,
    compactionThresholdRatio: input.policy.compactionThresholdRatio,
  });
}

export function recordContextUsage(input: {
  readonly request: RecordCompletedModelCallUsageRequest;
  readonly policy: ContextPolicy;
  readonly cache: ContextUsageSnapshotCache;
  readonly now: () => string;
}): RecordCompletedModelCallUsageResult {
  if (!isValidUsageRequest(input.request)) {
    return {
      status: 'failed',
      failure: {
        code: 'usage_snapshot_invalid',
        message: 'Completed Model Call usage snapshot input is invalid.',
        retryable: false,
      },
    };
  }
  const usage = input.request.providerInputTokens === undefined
    ? input.request.preCallUsage
    : calculateContextUsage({
        inputTokens: input.request.providerInputTokens,
        capacity: contextCapacityFromModel(input.request.model),
        policy: input.policy,
      });
  const snapshot: SessionContextUsageSnapshot = Object.freeze({
    sessionId: input.request.sessionId,
    runId: input.request.runId,
    providerId: input.request.model.provider,
    modelId: input.request.model.id,
    usage,
    accuracy: input.request.providerInputTokens === undefined ? 'estimated' : 'provider_reported',
    calculatedAt: input.now(),
  });
  input.cache.set(input.request.sessionId, snapshot);
  return { status: 'recorded', snapshot };
}

function isValidUsageRequest(request: RecordCompletedModelCallUsageRequest): boolean {
  const usage = request.preCallUsage;
  const validUsage = Number.isInteger(usage.usedTokens) && usage.usedTokens >= 0
    && Number.isInteger(request.model.contextWindow) && request.model.contextWindow > 0
    && usage.contextWindowTokens === request.model.contextWindow
    && usage.remainingTokens === usage.contextWindowTokens - usage.usedTokens
    && usage.usedRatio === usage.usedTokens / usage.contextWindowTokens
    && Number.isFinite(usage.compactionThresholdRatio)
    && usage.compactionThresholdRatio > 0
    && usage.compactionThresholdRatio < 1;
  const validProvider = request.providerInputTokens === undefined
    || (Number.isInteger(request.providerInputTokens) && request.providerInputTokens >= 0);
  return Boolean(
    request.sessionId
    && request.runId
    && request.model.provider
    && request.model.id
    && validUsage
    && validProvider,
  );
}
