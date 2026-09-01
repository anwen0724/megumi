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
  type SessionParticipation,
  type SetSessionParticipationRequest,
} from './interest';
import {
  createInterestExtractionQueue,
  type InterestExtractionJob,
  type InterestExtractionQueue,
} from './interest-extraction-queue';
import type { InterestExtractor } from './interest-extraction';
import type { InterestRepository } from '../persistence/interest-repository';
import type {
  InterestUnderstanding,
  InterestUnderstandingReceipt,
} from './interest-understanding';

export interface ObserveConversationTurnRequest {
  readonly sessionId: string;
  readonly executionId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly completedAt: string;
}

export type ObserveConversationTurnResult =
  | { readonly status: 'accepted'; readonly receipt: InterestUnderstandingReceipt }
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
    createInterestUnderstandingId(): string;
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
  setSessionParticipation(request: SetSessionParticipationRequest): Promise<SessionParticipation>;
  /** Enqueues one eligible completed turn without blocking conversation completion. */
  observeConversationTurn(request: ObserveConversationTurnRequest): ObserveConversationTurnResult;
  getInterestUnderstanding(interestUnderstandingId: string): InterestUnderstanding | undefined;
  findInterestUnderstandingByExecution(executionId: string): InterestUnderstanding | undefined;
  /** Retracts one Session's Evidence and unsupported inferred Interests. */
  retractSessionEvidence(sessionId: string): Promise<void>;
  /** Stops and drains the owned extraction worker. */
  shutdown(): Promise<void>;
}

/** Creates Interest commands and the owned post-conversation extraction worker. */
export function createInterestRuntime(options: CreateInterestRuntimeOptions): InterestRuntime {
  let accepting = true;
  options.repository.interruptRunningInterestUnderstandings({ interruptedAt: options.clock.now() });
  const queue = createInterestExtractionQueue({
    process: async (job, signal) => {
      const startedAt = options.clock.now();
      options.repository.updateInterestUnderstanding({
        ...interestUnderstandingBase(job),
        status: 'running',
        startedAt,
      });
      try {
        const result = await withInterestUnderstandingTrace(options, job, () => (
          processJob(options, job, signal)
        ));
        options.repository.updateInterestUnderstanding({
          ...interestUnderstandingBase(job),
          status: 'completed',
          startedAt,
          completedAt: options.clock.now(),
          ...result,
          changedInterestIds: [...result.changedInterestIds],
          evidenceIds: [...result.evidenceIds],
        });
      } catch (error) {
        options.repository.updateInterestUnderstanding({
          ...interestUnderstandingBase(job),
          status: signal.aborted ? 'interrupted' : 'failed',
          startedAt,
          completedAt: options.clock.now(),
          failure: {
            code: signal.aborted ? 'operation_interrupted' : 'interest_understanding_failed',
            message: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      }
    },
    onError: (error, job) => options.onError?.(error, job),
  });

  return {
    async changeInterest(request) {
      const now = options.clock.now();
      return options.repository.changeInterest(request.action === 'create'
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

    async setSessionParticipation(request) {
      const session = options.sessions.getSession({ session_id: request.sessionId });
      if (session.status !== 'found') throw new Error('Session was not found.');
      const now = options.clock.now();
      const policy = options.repository.setSessionParticipation({
        sessionId: request.sessionId,
        participation: request.participation,
        effectiveFrom: now,
        updatedAt: now,
      });
      if (request.participation === 'excluded') {
        const affected = options.repository.retractSessionEvidence(request.sessionId, now);
        if (affected.length > 0) options.onInterestsChanged?.(affected);
      }
      return policy;
    },

    observeConversationTurn(request) {
      if (!accepting) return { status: 'skipped', reason: 'shutting_down' };
      const admission = canProcess(options, request.sessionId, request.completedAt);
      if (admission) return { status: 'skipped', reason: admission };
      const queuedAt = options.clock.now();
      const receipt = options.repository.createInterestUnderstanding({
        interestUnderstandingId: options.ids.createInterestUnderstandingId(),
        executionId: request.executionId,
        sessionId: request.sessionId,
        userMessageId: request.userMessageId,
        assistantMessageId: request.assistantMessageId,
        status: 'queued',
        queuedAt,
      });
      const job = queue.submit({ ...request, queuedAt, interestUnderstandingId: receipt.interestUnderstandingId });
      return job
        ? { status: 'accepted', receipt: {
            interestUnderstandingId: receipt.interestUnderstandingId,
            executionId: receipt.executionId,
            status: 'queued',
            queuedAt: receipt.queuedAt,
          } }
        : interruptedAdmission(options, receipt);
    },

    getInterestUnderstanding: (id) => options.repository.getInterestUnderstanding(id),
    findInterestUnderstandingByExecution: (id) => options.repository.findInterestUnderstandingByExecution(id),

    async retractSessionEvidence(sessionId) {
      const affected = options.repository.retractSessionEvidence(sessionId, options.clock.now());
      if (affected.length > 0) options.onInterestsChanged?.(affected);
    },

    async shutdown() {
      accepting = false;
      await queue.shutdown();
      options.repository.interruptRunningInterestUnderstandings({ interruptedAt: options.clock.now() });
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
    setSessionParticipation: unavailable,
    observeConversationTurn: () => ({ status: 'skipped', reason: 'recognition_disabled' }),
    getInterestUnderstanding: () => undefined,
    findInterestUnderstandingByExecution: () => undefined,
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
  const policy = options.repository.getSessionParticipation(sessionId);
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
): Promise<{
  readonly outcome: 'evidence_committed' | 'no_durable_evidence';
  readonly changedInterestIds: readonly string[];
  readonly evidenceIds: readonly string[];
}> {
  if (signal.aborted) throw new Error('Interest Understanding was interrupted.');
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

  const interests = options.repository.listInterests();
  const pendingEvidence = options.repository.listPendingEvidence();
  const resolvedModel = await observeInterestSpan(options, 'model.resolve', job, options.resolveModel);
  if (resolvedModel.status === 'failed') throw new Error(resolvedModel.failure.message);
  if (signal.aborted) throw new Error('Interest Understanding was interrupted.');
  const extracted = await options.extractor({
    job,
    userText: sessionMessageText(user.message),
    assistantText: sessionMessageText(assistant.message),
    interests,
    pendingEvidence,
    model: resolvedModel.model,
    signal,
  });
  if (signal.aborted) throw new Error('Interest Understanding was interrupted.');

  const durable = await observeInterestSpan(options, 'interest.result.validate', job, async () => {
    const validated = InterestExtractionResultSchema.parse(extracted);
    const availableInterestIds = new Set(interests.map((interest) => interest.interestId));
    const availableEvidenceIds = new Set(pendingEvidence.map((evidence) => evidence.evidenceId));
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
    changedInterestIds: changed.map(({ interestId }) => interestId),
  }, job);
  if (changed.length > 0) options.onInterestsChanged?.(changed.map(({ interestId }) => interestId));
  return {
    outcome: 'evidence_committed',
    changedInterestIds: changed.map(({ interestId }) => interestId),
    evidenceIds: evidence.map(({ evidenceId }) => evidenceId),
  };
}

async function withInterestUnderstandingTrace<T extends {
  readonly outcome: 'evidence_committed' | 'no_durable_evidence';
}>(
  options: CreateInterestRuntimeOptions,
  job: InterestExtractionJob,
  operation: () => Promise<T>,
): Promise<T> {
  let promise: Promise<T> | undefined;
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
      return runOnce();
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
  kind: 'interest.understanding.result' | 'interest.committed',
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
    interestUnderstandingId: job.interestUnderstandingId,
    executionId: job.executionId,
    sessionId: job.sessionId,
    messageId: job.userMessageId,
    userMessageId: job.userMessageId,
    assistantMessageId: job.assistantMessageId,
  };
}

function interestUnderstandingBase(job: InterestExtractionJob) {
  return {
    interestUnderstandingId: job.interestUnderstandingId,
    executionId: job.executionId,
    sessionId: job.sessionId,
    userMessageId: job.userMessageId,
    assistantMessageId: job.assistantMessageId,
    queuedAt: job.queuedAt,
  } as const;
}

function noDurableEvidence() {
  return {
    outcome: 'no_durable_evidence',
    changedInterestIds: [],
    evidenceIds: [],
  } as const;
}

function interruptedAdmission(
  options: CreateInterestRuntimeOptions,
  receipt: InterestUnderstanding,
): Extract<ObserveConversationTurnResult, { readonly status: 'skipped' }> {
  options.repository.updateInterestUnderstanding({
    ...receipt,
    status: 'interrupted',
    completedAt: options.clock.now(),
    failure: { code: 'shutting_down', message: 'Interest runtime is shutting down.' },
  });
  return { status: 'skipped', reason: 'shutting_down' };
}
