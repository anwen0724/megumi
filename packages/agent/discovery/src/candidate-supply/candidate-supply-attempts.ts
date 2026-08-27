/*
 * Maps Candidate Supply ToolCalls to Source operations and atomic Candidate Supply repository commits.
 */
import { randomUUID } from 'node:crypto';
import type { Observability, OperationCompletion, TraceCorrelation } from '@megumi/observability';
import type { RawToolResult } from '@megumi/tools';
import {
  CandidateSupplyCommitInputSchema,
  CandidateSupplySearchInputSchema,
  type Candidate,
  type CandidatePoolSnapshot,
  type CandidateSupplyRepository,
} from './candidate-supply';
import type { SourceRegistry } from '../sources/source-registry';

const MAX_SEARCH_CALLS = 12;
const MAX_READ_CALLS = 40;
const MAX_RAW_RESULTS = 200;

interface AttemptRecord {
  readonly startedAt: string;
  readonly trigger: string;
  readonly repository: CandidateSupplyRepository;
  readonly sourceRegistry: SourceRegistry;
  readonly enabledSourceIds: ReadonlySet<string>;
  readonly allowedCandidateIds: Set<string>;
  readonly readCandidateIds: Set<string>;
  readonly sourceTails: Map<string, Promise<void>>;
  readonly getSnapshot: () => CandidatePoolSnapshot;
  readonly now: () => string;
  searchCount: number;
  searchSucceededCount: number;
  sourceFailureCount: number;
  readCount: number;
  rawResultCount: number;
  admissionCommitCount: number;
  admittedCandidateCount: number;
  rejectedCandidateCount: number;
  needsDetailCandidateCount: number;
}

export interface CandidateSupplyAttemptSummary {
  readonly searchesStarted: number;
  readonly searchesSucceeded: number;
  readonly sourceFailures: number;
  readonly readsStarted: number;
  readonly rawResultsReceived: number;
  readonly admissionCommits: number;
  readonly admittedCandidates: number;
  readonly rejectedCandidates: number;
  readonly needsDetailCandidates: number;
}

export interface CandidateSupplyAttemptContextState {
  readonly startedAt: string;
  readonly trigger: string;
  readonly asOf: string;
  readonly snapshot: CandidatePoolSnapshot;
  readonly budget: {
    readonly searchesRemaining: number;
    readonly readsRemaining: number;
    readonly rawResultsRemaining: number;
  };
}

export interface CandidateSupplyAttempts {
  start(request: {
    readonly executionId: string;
    readonly startedAt: string;
    readonly trigger: string;
    readonly repository: CandidateSupplyRepository;
    readonly sourceRegistry: SourceRegistry;
    readonly enabledSourceIds: readonly string[];
    readonly initialCandidateIds: readonly string[];
    readonly getSnapshot: () => CandidatePoolSnapshot;
    readonly now: () => string;
  }): void;
  ownsExecution(executionId: string): boolean;
  readContextState(executionId: string): CandidateSupplyAttemptContextState | undefined;
  summarize(executionId: string): CandidateSupplyAttemptSummary | undefined;
  dispose(executionId: string): void;
  searchContent(request: {
    readonly executionId: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
  }): Promise<RawToolResult>;
  readSourceCandidate(request: {
    readonly executionId: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
  }): Promise<RawToolResult>;
  commitCandidateAdmission(request: {
    readonly executionId: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
  }): Promise<RawToolResult>;
}

export function createCandidateSupplyAttempts(options: {
  readonly observability?: Observability;
} = {}): CandidateSupplyAttempts {
  const records = new Map<string, AttemptRecord>();

  return {
    start(request) {
      if (records.has(request.executionId)) {
        throw new Error(`Candidate Supply attempt already exists: ${request.executionId}.`);
      }
      records.set(request.executionId, {
        startedAt: request.startedAt,
        trigger: request.trigger,
        repository: request.repository,
        sourceRegistry: request.sourceRegistry,
        enabledSourceIds: new Set(request.enabledSourceIds),
        allowedCandidateIds: new Set(request.initialCandidateIds),
        readCandidateIds: new Set(),
        sourceTails: new Map(),
        getSnapshot: request.getSnapshot,
        now: request.now,
        searchCount: 0,
        searchSucceededCount: 0,
        sourceFailureCount: 0,
        readCount: 0,
        rawResultCount: 0,
        admissionCommitCount: 0,
        admittedCandidateCount: 0,
        rejectedCandidateCount: 0,
        needsDetailCandidateCount: 0,
      });
    },

    ownsExecution: (executionId) => records.has(executionId),
    readContextState(executionId) {
      const attempt = records.get(executionId);
      return attempt ? {
        startedAt: attempt.startedAt,
        trigger: attempt.trigger,
        asOf: attempt.now(),
        snapshot: attempt.getSnapshot(),
        budget: remainingBudget(attempt),
      } : undefined;
    },
    summarize(executionId) {
      const attempt = records.get(executionId);
      return attempt ? attemptSummary(attempt) : undefined;
    },
    dispose: (executionId) => { records.delete(executionId); },

    async searchContent(request) {
      const attempt = records.get(request.executionId);
      if (!attempt) return toolError('attempt_not_found', 'Candidate Supply attempt was not found.');
      if (request.signal.aborted) return toolError('tool_cancelled', 'Search was cancelled.');
      const parsed = CandidateSupplySearchInputSchema.safeParse(request.input);
      if (!parsed.success) return toolError('invalid_search_request', 'Candidate Supply search input is invalid.');
      if (attempt.searchCount >= MAX_SEARCH_CALLS) {
        return toolError('search_budget_exhausted', 'The 12-search budget is exhausted.');
      }
      if (attempt.rawResultCount >= MAX_RAW_RESULTS) {
        return toolError('candidate_budget_exhausted', 'The 200-result budget is exhausted.');
      }
      if (!attempt.enabledSourceIds.has(parsed.data.sourceId)) {
        return toolError('source_not_enabled', `Source ${parsed.data.sourceId} is not enabled.`);
      }
      const source = attempt.sourceRegistry.get(parsed.data.sourceId);
      if (!source || !source.descriptor.supportedModes.includes(parsed.data.mode)) {
        return toolError('invalid_search_request', 'Source or search mode is unavailable.');
      }
      const availability = source.getAvailability();
      const now = attempt.now();
      const persistedSourceState = attempt.repository.readSourceState(parsed.data.sourceId);
      if (availability.state !== 'ready'
        || (availability.retryAt && Date.parse(availability.retryAt) > Date.parse(now))
        || (persistedSourceState?.retryAt && Date.parse(persistedSourceState.retryAt) > Date.parse(now))) {
        return toolError('source_unavailable', `Source ${parsed.data.sourceId} is ${availability.state}.`);
      }
      if (attempt.repository.isQueryCoolingDown({ ...parsed.data, now })) {
        return toolError('query_cooling_down', 'This Source and Query intent is cooling down.');
      }
      const effectiveLimit = Math.min(parsed.data.limit, MAX_RAW_RESULTS - attempt.rawResultCount);
      const queryId = `candidate-query:${randomUUID()}`;
      try {
        attempt.repository.beginQuery({
          queryId,
          executionId: request.executionId,
          sourceId: parsed.data.sourceId,
          query: parsed.data.query,
          mode: parsed.data.mode,
          targetInterestIds: parsed.data.targetInterestIds,
          startedAt: now,
        });
      } catch (error) {
        return toolError('query_rejected', messageOf(error));
      }
      attempt.searchCount += 1;
      const correlation = { executionId: request.executionId, sourceId: parsed.data.sourceId };
      return observeOperation(options.observability, 'source.search', correlation, async () => {
        safeRecordContent(options.observability, 'source.request', {
          queryId, ...parsed.data, limit: effectiveLimit,
        }, correlation);
        const result = await withSourceLock(attempt, parsed.data.sourceId, () => source.search({
          query: parsed.data.query,
          mode: parsed.data.mode,
          limit: effectiveLimit,
          signal: request.signal,
          onProviderResponse: (response) => safeRecordContent(
            options.observability, 'source.provider_response', response, correlation,
          ),
        }));
        safeRecordContent(options.observability, 'source.result', result, correlation);
        if (result.status === 'failed') {
          attempt.sourceFailureCount += 1;
          safeSettleSourceAttempt(attempt.repository, {
            sourceId: parsed.data.sourceId,
            result: result.failure.code === 'cancelled' ? 'cancelled' : 'failed',
            failureCode: result.failure.code,
            ...(source.getAvailability().retryAt ? { providerRetryAt: source.getAvailability().retryAt } : {}),
            now: attempt.now(),
          });
          safeFailQuery(attempt.repository, {
            queryId,
            status: result.failure.code === 'cancelled' ? 'cancelled' : 'failed',
            completedAt: attempt.now(),
            failureCode: result.failure.code,
            failureMessage: result.failure.message,
          });
          return toolError(result.failure.code, result.failure.message, { queryId, failure: result.failure });
        }
        const items = result.items.slice(0, effectiveLimit);
        attempt.rawResultCount += items.length;
        try {
          const committed = attempt.repository.commitSearchResult({
            queryId,
            completedAt: attempt.now(),
            items,
            hardLimit: attempt.getSnapshot().thresholds.hardLimit,
          });
          for (const candidate of committed.candidates) {
            attempt.allowedCandidateIds.add(candidate.candidateId);
          }
          attempt.searchSucceededCount += 1;
          safeSettleSourceAttempt(attempt.repository, {
            sourceId: parsed.data.sourceId, result: 'success', now: attempt.now(),
          });
          return toolSuccess({
            status: 'success',
            query: committed.query,
            admissionBatch: committed.candidates.map((candidate) => assessmentCandidate(attempt, candidate)),
            pool: attempt.getSnapshot(),
            budget: remainingBudget(attempt),
          });
        } catch (error) {
          safeSettleSourceAttempt(attempt.repository, {
            sourceId: parsed.data.sourceId, result: 'persistence_error',
            failureCode: 'persistence_error', now: attempt.now(),
          });
          safeFailQuery(attempt.repository, {
            queryId, status: 'failed', completedAt: attempt.now(),
            failureCode: 'persistence_error', failureMessage: messageOf(error),
          });
          return toolError('persistence_error', 'Candidate search result could not be committed.', { queryId });
        }
      });
    },

    async readSourceCandidate(request) {
      const attempt = records.get(request.executionId);
      if (!attempt) return toolError('attempt_not_found', 'Candidate Supply attempt was not found.');
      if (request.signal.aborted) return toolError('tool_cancelled', 'Candidate read was cancelled.');
      if (attempt.readCount >= MAX_READ_CALLS) return toolError('read_budget_exhausted', 'The 40-read budget is exhausted.');
      const candidateId = recordString(request.input, 'candidateId');
      if (!candidateId || !attempt.allowedCandidateIds.has(candidateId)) {
        return toolError('candidate_not_in_context', 'Candidate is not in this execution context.');
      }
      if (attempt.readCandidateIds.has(candidateId)) {
        return toolError('candidate_already_read', 'Candidate was already read in this execution.');
      }
      const candidate = attempt.repository.readCandidate(candidateId);
      if (!candidate || candidate.status !== 'preparing') {
        return toolError('candidate_not_preparing', 'Only a preparing Candidate can be read.');
      }
      const source = attempt.sourceRegistry.get(candidate.primarySourceId);
      if (!source?.read) return toolError('read_unavailable', 'Candidate Source cannot provide detail.');
      const sourceState = attempt.repository.readSourceState(candidate.primarySourceId);
      const availability = source.getAvailability();
      if (availability.state !== 'ready'
        || (availability.retryAt && Date.parse(availability.retryAt) > Date.parse(attempt.now()))
        || (sourceState?.retryAt && Date.parse(sourceState.retryAt) > Date.parse(attempt.now()))) {
        return toolError('source_unavailable', `Source ${candidate.primarySourceId} is cooling down.`);
      }
      attempt.readCount += 1;
      attempt.readCandidateIds.add(candidateId);
      const correlation = {
        executionId: request.executionId,
        sourceId: candidate.primarySourceId,
        candidateId,
      };
      return observeOperation(options.observability, 'source.read', correlation, async () => {
        const result = await source.read!({
          sourceContentId: candidate.sourceContentId,
          url: candidate.canonicalUrl,
          signal: request.signal,
          onProviderResponse: (response) => safeRecordContent(
            options.observability, 'source.provider_response', response, correlation,
          ),
        });
        safeRecordContent(options.observability, 'source.result', result, correlation);
        if (result.status === 'failed') {
          safeSettleSourceAttempt(attempt.repository, {
            sourceId: candidate.primarySourceId,
            result: result.failure.code === 'cancelled' ? 'cancelled' : 'failed',
            failureCode: result.failure.code,
            ...(source.getAvailability().retryAt ? { providerRetryAt: source.getAvailability().retryAt } : {}),
            now: attempt.now(),
          });
          return toolError(result.failure.code, result.failure.message);
        }
        try {
          const updated = attempt.repository.commitCandidateDetail({
            candidateId, detail: result.detail, now: attempt.now(),
          });
          safeSettleSourceAttempt(attempt.repository, {
            sourceId: candidate.primarySourceId, result: 'success', now: attempt.now(),
          });
          return toolSuccess({
            status: 'success',
            candidate: assessmentCandidate(attempt, updated),
            pool: attempt.getSnapshot(),
            budget: remainingBudget(attempt),
          });
        } catch (error) {
          return toolError('invalid_candidate_detail', messageOf(error));
        }
      });
    },

    async commitCandidateAdmission(request) {
      const attempt = records.get(request.executionId);
      if (!attempt) return toolError('attempt_not_found', 'Candidate Supply attempt was not found.');
      if (request.signal.aborted) return toolError('tool_cancelled', 'Admission commit was cancelled.');
      const parsed = CandidateSupplyCommitInputSchema.safeParse(request.input);
      if (!parsed.success) return toolError('invalid_admission_request', 'Admission decisions are invalid.');
      if (parsed.data.decisions.some((decision) => !attempt.allowedCandidateIds.has(decision.candidateId))) {
        return toolError('candidate_not_in_context', 'Admission references a Candidate outside this execution context.');
      }
      const unreadable = parsed.data.decisions.find((decision) => {
        if (decision.decision !== 'needs_detail') return false;
        const candidate = attempt.repository.readCandidate(decision.candidateId);
        return !candidate || !attempt.sourceRegistry.get(candidate.primarySourceId)?.read;
      });
      if (unreadable) {
        return toolError(
          'admission_commit_failed',
          'needs_detail requires a Candidate Source that can read additional content.',
        );
      }
      return observeOperation(
        options.observability,
        'candidate.admission.commit',
        { executionId: request.executionId },
        async () => {
          try {
            const candidates = attempt.repository.commitAdmission({
              executionId: request.executionId,
              assessmentVersion: 'candidate-admission:v1',
              assessedAt: attempt.now(),
              decisions: parsed.data.decisions,
            });
            attempt.admissionCommitCount += 1;
            for (const decision of parsed.data.decisions) {
              if (decision.decision === 'admit') attempt.admittedCandidateCount += 1;
              else if (decision.decision === 'reject') attempt.rejectedCandidateCount += 1;
              else attempt.needsDetailCandidateCount += 1;
            }
            return toolSuccess({
              status: 'committed',
              candidates,
              pool: attempt.getSnapshot(),
              budget: remainingBudget(attempt),
            });
          } catch (error) {
            return toolError('admission_commit_failed', messageOf(error));
          }
        },
      );
    },
  };
}

function assessmentCandidate(attempt: AttemptRecord, candidate: Candidate) {
  return {
    candidate,
    potentialDuplicates: attempt.repository.listPotentialDuplicates(candidate.candidateId, 10),
  };
}

function remainingBudget(attempt: AttemptRecord) {
  return {
    searchesRemaining: Math.max(0, MAX_SEARCH_CALLS - attempt.searchCount),
    readsRemaining: Math.max(0, MAX_READ_CALLS - attempt.readCount),
    rawResultsRemaining: Math.max(0, MAX_RAW_RESULTS - attempt.rawResultCount),
  };
}

function attemptSummary(attempt: AttemptRecord): CandidateSupplyAttemptSummary {
  return {
    searchesStarted: attempt.searchCount,
    searchesSucceeded: attempt.searchSucceededCount,
    sourceFailures: attempt.sourceFailureCount,
    readsStarted: attempt.readCount,
    rawResultsReceived: attempt.rawResultCount,
    admissionCommits: attempt.admissionCommitCount,
    admittedCandidates: attempt.admittedCandidateCount,
    rejectedCandidates: attempt.rejectedCandidateCount,
    needsDetailCandidates: attempt.needsDetailCandidateCount,
  };
}

async function observeOperation(
  observability: Observability | undefined,
  name: 'source.search' | 'source.read' | 'candidate.admission.commit',
  correlation: TraceCorrelation,
  operation: () => Promise<RawToolResult>,
): Promise<RawToolResult> {
  let promise: Promise<RawToolResult> | undefined;
  const runOnce = () => (promise ??= operation());
  if (!observability) return runOnce();
  try {
    return await observability.withSpan({
      name,
      correlation,
      classifyResult: classifyToolResult,
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function classifyToolResult(result: RawToolResult): OperationCompletion {
  if (!result.isError) return { outcome: { status: 'ok' } };
  return {
    outcome: {
      status: 'error',
      code: recordString(result.content, 'code') ?? 'candidate_supply_tool_failed',
      message: recordString(result.content, 'message') ?? 'Candidate Supply Tool failed.',
    },
  };
}

function safeRecordContent(
  observability: Observability | undefined,
  kind: 'source.request' | 'source.provider_response' | 'source.result',
  value: unknown,
  correlation: TraceCorrelation,
): void {
  try {
    observability?.recordContent({ kind, value, correlation });
  } catch {
    // Source and Candidate commits do not depend on diagnostic capture.
  }
}

function safeFailQuery(
  repository: CandidateSupplyRepository,
  input: Parameters<CandidateSupplyRepository['failQuery']>[0],
): void {
  try {
    repository.failQuery(input);
  } catch {
    // Preserve the original Tool failure when persistence itself is unavailable.
  }
}

function safeSettleSourceAttempt(
  repository: CandidateSupplyRepository,
  input: Parameters<CandidateSupplyRepository['settleSourceAttempt']>[0],
): void {
  try {
    repository.settleSourceAttempt(input);
  } catch {
    // Source cooldown persistence cannot rewrite an already formed Tool result.
  }
}

function toolSuccess(content: unknown): RawToolResult {
  return { outputKind: 'json', content };
}

function toolError(code: string, message: string, details?: unknown): RawToolResult {
  return {
    outputKind: 'json',
    content: { status: 'failed', code, message, ...(details === undefined ? {} : { details }) },
    isError: true,
  };
}

function recordString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.trim() ? field.trim() : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Candidate Supply operation failed.';
}

async function withSourceLock<T>(
  attempt: AttemptRecord,
  sourceId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = attempt.sourceTails.get(sourceId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => gate);
  attempt.sourceTails.set(sourceId, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (attempt.sourceTails.get(sourceId) === tail) attempt.sourceTails.delete(sourceId);
  }
}
