/*
 * Coordinates public Interest operations and the post-conversation extraction worker.
 */
import type { Api, Model } from '@megumi/ai';
import type {
  Observability,
  OperationCompletion,
  TraceCorrelation,
} from '@megumi/observability';
import type { SessionCatalog, SessionHistory } from '@megumi/session';
import { sessionMessageText } from '@megumi/session';
import {
  InterestExtractionResultSchema,
  type ChangeInterestRequest,
  type Interest,
  type InterestEvidence,
  type InterestSessionSetting,
  type SetInterestSessionSettingRequest,
} from './interest';
import {
  createInterestExtractionQueue,
  type InterestExtractionJob,
  type InterestExtractionOutcome,
  type InterestExtractionQueue,
} from './interest-extraction-queue';
import type { InterestExtractor } from './interest-extraction';
import type { InterestRepository } from '../persistence/interest-repository';

export interface ObserveConversationTurnRequest {
  readonly sessionId: string;
  readonly executionId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly completedAt: string;
}

export type ObserveConversationTurnResult =
  | { readonly status: 'accepted' }
  | {
      readonly status: 'skipped';
      readonly reason: 'recognition_disabled' | 'session_excluded' | 'before_effective_from' | 'shutting_down';
    };

export interface CreateInterestRuntimeOptions {
  readonly repository: InterestRepository;
  readonly settings: {
    getDiscoverySettings(): { readonly conversationRecognitionEnabled: boolean };
  };
  readonly sessions: Pick<SessionCatalog, 'getSession'>;
  readonly history: Pick<SessionHistory, 'getCommittedRunMessages'>;
  readonly resolveModel: () => Promise<
    | { readonly status: 'ok'; readonly model: Model<Api> }
    | { readonly status: 'failed'; readonly failure: { readonly message: string } }
  >;
  readonly extractor: InterestExtractor['extract'];
  readonly ids: {
    createInterestId(): string;
    createEvidenceId(): string;
  };
  readonly clock: { now(): string };
  readonly observability?: Observability;
  readonly onError?: (error: unknown, job?: InterestExtractionJob) => void;
  readonly onInterestsChanged?: (interestIds: readonly string[]) => void;
}

export interface InterestRuntime {
  /** Applies one explicit user Interest command. */
  changeInterest(request: ChangeInterestRequest): Promise<Interest>;
  /** Changes whether one Session contributes future Interest Evidence. */
  setInterestSessionSetting(request: SetInterestSessionSettingRequest): Promise<InterestSessionSetting>;
  /** Enqueues one eligible completed turn without blocking conversation completion. */
  observeConversationTurn(request: ObserveConversationTurnRequest): ObserveConversationTurnResult;
  /** Reads the exact Interest and Evidence business facts requested by their identities. */
  getInterestFacts(request: {
    readonly interestIds: readonly string[];
    readonly evidenceIds: readonly string[];
  }): {
    readonly interests: readonly Interest[];
    readonly evidence: readonly InterestEvidence[];
  };
  /** Retracts one Session's Evidence and unsupported inferred Interests. */
  retractSessionEvidence(sessionId: string): Promise<void>;
  /** Stops and drains the owned extraction worker. */
  shutdown(): Promise<void>;
}

/** Creates Interest commands and the owned post-conversation extraction worker. */
export function createInterestRuntime(options: CreateInterestRuntimeOptions): InterestRuntime {
  let accepting = true;
  const queue = createInterestExtractionQueue({
    process: (job, signal) => processJob(options, job, signal),
    observe: (job, operation) => withInterestUnderstandingTrace(options, job, operation),
    onError: (error, job) => options.onError?.(error, job),
  });

  return {
    async changeInterest(request) {
      const now = options.clock.now();
      return options.repository.applyInterestChange(request.action === 'create'
        ? {
            action: 'create',
            interestId: options.ids.createInterestId(),
            description: request.description,
            now,
          }
        : request.action === 'update'
          ? { ...request, now }
          : { ...request, now });
    },

    async setInterestSessionSetting(request) {
      const session = options.sessions.getSession({ session_id: request.sessionId });
      if (session.status !== 'found') throw new Error('Session was not found.');
      const now = options.clock.now();
      const result = options.repository.applyInterestSessionSettingChange({
        sessionId: request.sessionId,
        participation: request.participation,
        effectiveFrom: now,
        updatedAt: now,
      });
      if (result.affectedInterestIds.length > 0) {
        options.onInterestsChanged?.(result.affectedInterestIds);
      }
      return result.participation;
    },

    observeConversationTurn(request) {
      if (!accepting) return { status: 'skipped', reason: 'shutting_down' };
      const admission = canProcess(options, request.sessionId, request.completedAt);
      if (admission) return { status: 'skipped', reason: admission };
      const queuedAt = options.clock.now();
      return queue.submit({ ...request, queuedAt })
        ? { status: 'accepted' }
        : { status: 'skipped', reason: 'shutting_down' };
    },

    getInterestFacts: ({ interestIds, evidenceIds }) => ({
      interests: options.repository.listInterestsByIds(interestIds),
      evidence: options.repository.listInterestEvidenceByIds(evidenceIds),
    }),

    async retractSessionEvidence(sessionId) {
      const affected = options.repository.retractSessionEvidence({
        sessionId,
        retractedAt: options.clock.now(),
      });
      if (affected.length > 0) options.onInterestsChanged?.(affected);
    },

    async shutdown() {
      accepting = false;
      await queue.shutdown();
    },
  };
}

/** Creates the no-op Interest boundary used when conversation recognition is unavailable. */
export function createDisabledInterestRuntime(): InterestRuntime {
  const unavailable = async (): Promise<never> => {
    throw new Error('Interest runtime is not configured.');
  };
  return {
    changeInterest: unavailable,
    setInterestSessionSetting: unavailable,
    observeConversationTurn: () => ({ status: 'skipped', reason: 'recognition_disabled' }),
    getInterestFacts: () => ({ interests: [], evidence: [] }),
    retractSessionEvidence: async () => undefined,
    shutdown: async () => undefined,
  };
}

function canProcess(
  options: CreateInterestRuntimeOptions,
  sessionId: string,
  completedAt: string,
): 'recognition_disabled' | 'session_excluded' | 'before_effective_from' | undefined {
  if (!options.settings.getDiscoverySettings().conversationRecognitionEnabled) {
    return 'recognition_disabled';
  }
  const policy = options.repository.findInterestSessionSettingBySessionId(sessionId);
  if (policy?.participation === 'excluded') return 'session_excluded';
  if (policy?.participation === 'included' && completedAt < policy.effectiveFrom) {
    return 'before_effective_from';
  }
  return undefined;
}

/** Loads one committed turn, invokes extraction, and atomically applies validated Evidence. */
async function processJob(
  options: CreateInterestRuntimeOptions,
  job: InterestExtractionJob,
  signal: AbortSignal,
): Promise<InterestExtractionOutcome> {
  throwIfAborted(signal);
  if (canProcess(options, job.sessionId, job.completedAt)) return noDurableEvidence();
  if (options.sessions.getSession({ session_id: job.sessionId }).status !== 'found') return noDurableEvidence();
  const committed = await observeInterestSpan(options, 'interest.turn.resolve', job, () => Promise.resolve(
    options.history.getCommittedRunMessages({
      sessionId: job.sessionId,
      executionId: job.executionId,
    }),
  ));
  if (committed.status !== 'ok') return noDurableEvidence();
  const user = committed.messages.find((item) => (
    item.message.message_id === job.userMessageId
    && item.message.message_kind === 'user_message'
  ));
  const assistant = committed.messages.find((item) => (
    item.message.message_id === job.assistantMessageId
    && item.message.message_kind === 'assistant_reply'
    && item.message.status === 'completed'
  ));
  if (!user || !assistant) return noDurableEvidence();

  const interests = options.repository.listNonDeletedInterests();
  const pendingEvidence = options.repository.listPendingInterestEvidence();
  const resolvedModel = await observeInterestSpan(options, 'model.resolve', job, options.resolveModel);
  if (resolvedModel.status === 'failed') throw new Error(resolvedModel.failure.message);
  throwIfAborted(signal);
  const extracted = await options.extractor({
    job,
    userText: sessionMessageText(user.message),
    assistantText: sessionMessageText(assistant.message),
    interests,
    pendingEvidence,
    model: resolvedModel.model,
    signal,
  });
  throwIfAborted(signal);

  const durable = await observeInterestSpan(options, 'interest.result.validate', job, async () => {
    const validated = InterestExtractionResultSchema.parse(extracted);
    const availableInterestIds = new Set(interests.map((interest) => interest.id));
    const availableEvidenceIds = new Set(pendingEvidence.map((evidence) => evidence.id));
    for (const evidence of validated.evidence) {
      if (evidence.matchedInterestId && !availableInterestIds.has(evidence.matchedInterestId)) {
        throw new Error('Interest extraction returned an unknown Interest ID.');
      }
      if (evidence.supportingEvidenceIds?.some((id) => !availableEvidenceIds.has(id))) {
        throw new Error('Interest extraction returned an unknown Evidence ID.');
      }
    }
    safeRecordInterestContent(options, 'interest.understanding.result', validated, job);
    return validated.evidence.filter((evidence): evidence is typeof evidence & {
      readonly confidence: 'high' | 'medium';
    } => evidence.confidence !== 'low');
  });
  if (durable.length === 0) return noDurableEvidence();
  const evidence = durable.map((item) => ({
    evidenceId: options.ids.createEvidenceId(),
    interestId: options.ids.createInterestId(),
    description: item.description,
    effect: item.effect,
    confidence: item.confidence,
    ...(item.matchedInterestId ? { matchedInterestId: item.matchedInterestId } : {}),
    ...(item.supportingEvidenceIds ? { supportingEvidenceIds: item.supportingEvidenceIds } : {}),
  }));
  const changed = await observeInterestSpan(options, 'interest.commit', job, () => Promise.resolve(
    options.repository.applyInterestExtraction({
      sessionId: job.sessionId,
      messageId: job.userMessageId,
      now: options.clock.now(),
      evidence,
    }),
  ));
  safeRecordInterestContent(options, 'interest.committed', {
    evidence,
    changedInterestIds: changed.map(({ id }) => id),
  }, job);
  if (changed.length > 0) options.onInterestsChanged?.(changed.map(({ id }) => id));
  return {
    outcome: 'evidence_committed',
    changedInterestIds: changed.map(({ id }) => id),
    evidenceIds: evidence.map(({ evidenceId }) => evidenceId),
  };
}

async function withInterestUnderstandingTrace(
  options: CreateInterestRuntimeOptions,
  job: InterestExtractionJob,
  operation: () => Promise<InterestExtractionOutcome>,
): Promise<InterestExtractionOutcome> {
  let promise: Promise<InterestExtractionOutcome> | undefined;
  const runOnce = () => (promise ??= operation());
  if (!options.observability) return runOnce();
  try {
    return await options.observability.withTrace({
      kind: 'interest_understanding',
      correlation: interestCorrelation(job),
      classifyResult: (result): OperationCompletion => ({
        outcome: { status: 'ok', code: result.outcome },
      }),
    }, async () => {
      try {
        options.observability?.linkTrace({
          kind: 'continues',
          target: {
            by: 'correlation',
            traceKind: 'conversation',
            correlation: { executionId: job.executionId },
            state: 'latest_ended',
          },
          correlation: interestCorrelation(job),
        });
      } catch {
        // Linking is diagnostic-only and cannot block Interest Understanding.
      }
      const result = await runOnce();
      safeRecordInterestContent(options, 'interest.understanding.outcome', result, job);
      return result;
    });
  } catch {
    return runOnce();
  }
}

async function observeInterestSpan<T>(
  options: CreateInterestRuntimeOptions,
  name: 'interest.turn.resolve' | 'model.resolve' | 'interest.result.validate' | 'interest.commit',
  job: InterestExtractionJob,
  operation: () => Promise<T>,
): Promise<T> {
  let promise: Promise<T> | undefined;
  const runOnce = () => (promise ??= operation());
  if (!options.observability) return runOnce();
  try {
    return await options.observability.withSpan({
      name,
      correlation: interestCorrelation(job),
      classifyResult: (): OperationCompletion => ({ outcome: { status: 'ok' } }),
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function safeRecordInterestContent(
  options: CreateInterestRuntimeOptions,
  kind: 'interest.understanding.result' | 'interest.committed' | 'interest.understanding.outcome',
  value: unknown,
  job: InterestExtractionJob,
): void {
  try {
    options.observability?.recordContent({ kind, value, correlation: interestCorrelation(job) });
  } catch {
    // Content capture is fail-open and never changes durable Interest state.
  }
}

function interestCorrelation(job: InterestExtractionJob): TraceCorrelation {
  return {
    executionId: job.executionId,
    sessionId: job.sessionId,
    messageId: job.userMessageId,
    userMessageId: job.userMessageId,
    assistantMessageId: job.assistantMessageId,
  };
}

function noDurableEvidence() {
  return {
    outcome: 'no_durable_evidence',
    changedInterestIds: [],
    evidenceIds: [],
  } as const;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Interest Understanding was interrupted.', 'AbortError');
  }
}
