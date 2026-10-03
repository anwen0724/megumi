/* Owns the interest catalog responsibility of the Recommendation product. */
import type { Api, Model } from '@megumi/ai';
import { z } from 'zod';
import type { SessionCatalog } from '../../coding/sessions/session-catalog';
import type { SessionHistory } from '../../coding/sessions/session-history';
import { sessionMessageText } from '../../coding/sessions/session-history';
import type { Observability, OperationCompletion, TraceCorrelation } from '../../observability/index';
import type { Settings } from '../../settings/settings-store';
import type { InterestExtractor } from './extract-interests';
import type { InterestExtractionJob, InterestExtractionOutcome } from './extraction-queue';
import { createInterestExtractionQueue } from './extraction-queue';
import type { InterestRepository } from './interest-storage';

const TimestampSchema = z.string().datetime({ offset: true });

export const InterestDescriptionSchema = z.string().trim().min(1).max(1000);

export const InterestStatusSchema = z.enum(['active', 'paused', 'deleted']);

export const InterestCreatedFromSchema = z.enum(['manual', 'conversation']);

export const InterestSchema = z.object({
  id: z.string().min(1),
  description: InterestDescriptionSchema,
  status: InterestStatusSchema,
  createdFrom: InterestCreatedFromSchema,
  revision: z.number().int().nonnegative(),
  userManagedAt: TimestampSchema.optional(),
  descriptionUserEditedAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  pausedAt: TimestampSchema.optional(),
  deletedAt: TimestampSchema.optional(),
}).strict();

export const InterestEvidenceSchema = z.object({
  id: z.string().min(1),
  interestId: z.string().min(1).optional(),
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  description: InterestDescriptionSchema,
  effect: z.enum(['support', 'reject']),
  confidence: z.enum(['high', 'medium']),
  status: z.enum(['pending', 'applied', 'retracted']),
  createdAt: TimestampSchema,
  appliedAt: TimestampSchema.optional(),
  retractedAt: TimestampSchema.optional(),
}).strict();

export const InterestSessionSettingSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  participation: z.enum(['included', 'excluded']),
  effectiveFrom: TimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();

export const InterestExtractionResultSchema = z.object({
  evidence: z.array(z.object({
    description: InterestDescriptionSchema,
    effect: z.enum(['support', 'reject']),
    confidence: z.enum(['high', 'medium', 'low']),
    matchedInterestId: z.string().min(1).optional(),
    supportingEvidenceIds: z.array(z.string().min(1)).optional(),
  }).strict()),
}).strict();

export type Interest = z.infer<typeof InterestSchema>;

export type InterestEvidence = z.infer<typeof InterestEvidenceSchema>;

export type InterestSessionSetting = z.infer<typeof InterestSessionSettingSchema>;

export type InterestExtractionResult = z.infer<typeof InterestExtractionResultSchema>;

export type ChangeInterestRequest =
  | { readonly action: 'create'; readonly description: string; }
  | { readonly action: 'update'; readonly interestId: string; readonly description: string; }
  | { readonly action: 'pause'; readonly interestId: string; }
  | { readonly action: 'resume'; readonly interestId: string; }
  | { readonly action: 'delete'; readonly interestId: string; };

export interface SetInterestSessionSettingRequest {
  readonly sessionId: string;
  readonly participation: 'included' | 'excluded';
}

export interface ObserveConversationTurnRequest {
  readonly sessionId: string;
  readonly executionId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly completedAt: string;
}

export type ObserveConversationTurnResult =
  | { readonly status: 'accepted'; }
  | {
    readonly status: 'skipped';
    readonly reason:
    'recognition_disabled' | 'session_excluded' | 'before_effective_from' | 'shutting_down';
  };

export interface CreateInterestsOptions {
  readonly repository: InterestRepository;
  readonly settings: Pick<Settings, 'readSettings'>;
  readonly sessions: Pick<SessionCatalog, 'getSession'>;
  readonly history: Pick<SessionHistory, 'getCommittedRunMessages'>;
  readonly resolveModel: (request: {
    workspaceId: string;
    selection?: { providerId: string; modelId: string; };
  }) => Promise<Model<Api> | undefined>;
  readonly extractor: InterestExtractor['extract'];
  readonly ids: {
    createInterestId(): string;
    createEvidenceId(): string;
  };
  readonly clock: { now(): string; };
  readonly observability?: Observability;
  readonly onError?: (error: unknown, job?: InterestExtractionJob) => void;
  readonly onInterestsChanged?: (interestIds: readonly string[]) => void;
}

export interface Interests {
  /** Applies one explicit user Interest command. */
  changeInterest(request: ChangeInterestRequest): Promise<Interest>;
  /** Changes whether one Session contributes future Interest Evidence. */
  setInterestSessionSetting(
    request: SetInterestSessionSettingRequest,
  ): Promise<InterestSessionSetting>;
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
export function createInterests(options: CreateInterestsOptions): Interests {
  let accepting = true;
  const queue = createInterestExtractionQueue({
    process: (job, signal) => processJob(options, job, signal),
    observe: (job, operation) => withInterestUnderstandingTrace(options, job, operation),
    onError: (error, job) => options.onError?.(error, job),
  });

  return {
    async changeInterest(request) {
      const now = options.clock.now();
      return options.repository.applyInterestChange(
        request.action === 'create'
          ? {
            action: 'create',
            interestId: options.ids.createInterestId(),
            description: request.description,
            now,
          }
          : request.action === 'update'
            ? { ...request, now }
            : { ...request, now },
      );
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
export function createDisabledInterests(): Interests {
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
  options: CreateInterestsOptions,
  sessionId: string,
  completedAt: string,
): 'recognition_disabled' | 'session_excluded' | 'before_effective_from' | undefined {
  if (!readConfiguration(options.settings).discovery.conversationRecognitionEnabled) {
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
  options: CreateInterestsOptions,
  job: InterestExtractionJob,
  signal: AbortSignal,
): Promise<InterestExtractionOutcome> {
  throwIfAborted(signal);
  if (canProcess(options, job.sessionId, job.completedAt)) return noDurableEvidence();
  const session = options.sessions.getSession({ session_id: job.sessionId });
  if (session.status !== 'found') return noDurableEvidence();
  const committed = await observeInterestSpan(options, 'interest.turn.resolve', job, () =>
    Promise.resolve(
      options.history.getCommittedRunMessages({
        sessionId: job.sessionId,
        executionId: job.executionId,
      }),
    ),
  );
  if (committed.status !== 'ok') return noDurableEvidence();
  const user = committed.messages.find(
    (item) =>
      item.message.message_id === job.userMessageId && item.message.message_kind === 'user_message',
  );
  const assistant = committed.messages.find(
    (item) =>
      item.message.message_id === job.assistantMessageId &&
      item.message.message_kind === 'assistant_reply' &&
      item.message.status === 'completed',
  );
  if (!user || !assistant || assistant.message.message_kind !== 'assistant_reply')
    return noDurableEvidence();
  const reply = assistant.message;

  const interests = options.repository.listNonDeletedInterests();
  const pendingEvidence = options.repository.listPendingInterestEvidence();
  const resolvedModel = await observeInterestSpan(options, 'model.resolve', job, () =>
    options.resolveModel({
      workspaceId: session.session.workspace_id,
      selection:
        reply.provider && reply.model
          ? { providerId: reply.provider, modelId: reply.model }
          : session.session.model_selection,
    }),
  );
  if (!resolvedModel) throw new Error('Interest extraction model is unavailable.');
  throwIfAborted(signal);
  const extracted = await options.extractor({
    job,
    userText: sessionMessageText(user.message),
    assistantText: sessionMessageText(assistant.message),
    interests,
    pendingEvidence,
    model: resolvedModel,
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
    return validated.evidence.filter(
      (
        evidence,
      ): evidence is typeof evidence & {
        readonly confidence: 'high' | 'medium';
      } => evidence.confidence !== 'low',
    );
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
  const changed = await observeInterestSpan(options, 'interest.commit', job, () =>
    Promise.resolve(
      options.repository.applyInterestExtraction({
        sessionId: job.sessionId,
        messageId: job.userMessageId,
        now: options.clock.now(),
        evidence,
      }),
    ),
  );
  safeRecordInterestContent(
    options,
    'interest.committed',
    {
      evidence,
      changedInterestIds: changed.map(({ id }) => id),
    },
    job,
  );
  if (changed.length > 0) options.onInterestsChanged?.(changed.map(({ id }) => id));
  return {
    outcome: 'evidence_committed',
    changedInterestIds: changed.map(({ id }) => id),
    evidenceIds: evidence.map(({ evidenceId }) => evidenceId),
  };
}

async function withInterestUnderstandingTrace(
  options: CreateInterestsOptions,
  job: InterestExtractionJob,
  operation: () => Promise<InterestExtractionOutcome>,
): Promise<InterestExtractionOutcome> {
  let promise: Promise<InterestExtractionOutcome> | undefined;
  const runOnce = () => (promise ??= operation());
  if (!options.observability) return runOnce();
  try {
    return await options.observability.withTrace(
      {
        kind: 'interest_understanding',
        correlation: interestCorrelation(job),
        classifyResult: (result): OperationCompletion => ({
          outcome: { status: 'ok', code: result.outcome },
        }),
      },
      async () => {
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
      },
    );
  } catch {
    return runOnce();
  }
}

async function observeInterestSpan<T>(
  options: CreateInterestsOptions,
  name: 'interest.turn.resolve' | 'model.resolve' | 'interest.result.validate' | 'interest.commit',
  job: InterestExtractionJob,
  operation: () => Promise<T>,
): Promise<T> {
  let promise: Promise<T> | undefined;
  const runOnce = () => (promise ??= operation());
  if (!options.observability) return runOnce();
  try {
    return await options.observability.withSpan(
      {
        name,
        correlation: interestCorrelation(job),
        classifyResult: (): OperationCompletion => ({ outcome: { status: 'ok' } }),
      },
      runOnce,
    );
  } catch {
    return runOnce();
  }
}

function safeRecordInterestContent(
  options: CreateInterestsOptions,
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

function readConfiguration(settings: Pick<Settings, 'readSettings'>) {
  const result = settings.readSettings();
  if (result.status === 'rejected') throw new Error(result.error.message);
  return result.settings.config;
}
