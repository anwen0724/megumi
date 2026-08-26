/*
 * Coordinates public Interest operations and the post-conversation extraction worker.
 */
import type { Api, Model } from '@megumi/ai';
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
  readonly onError?: (error: unknown, job?: InterestExtractionJob) => void;
}

export interface InterestRuntime {
  /** Applies one explicit user Interest command. */
  changeInterest(request: ChangeInterestRequest): Promise<Interest>;
  /** Changes whether one Session contributes future Interest Evidence. */
  setSessionParticipation(request: SetSessionParticipationRequest): Promise<SessionParticipation>;
  /** Enqueues one eligible completed turn without blocking conversation completion. */
  observeConversationTurn(request: ObserveConversationTurnRequest): ObserveConversationTurnResult;
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
        options.repository.retractSessionEvidence(request.sessionId, now);
      }
      return policy;
    },

    observeConversationTurn(request) {
      if (!accepting) return { status: 'skipped', reason: 'shutting_down' };
      const admission = canProcess(options, request.sessionId, request.completedAt);
      if (admission) return { status: 'skipped', reason: admission };
      const job = queue.submit(request);
      return job
        ? { status: 'accepted' }
        : { status: 'skipped', reason: 'shutting_down' };
    },

    async retractSessionEvidence(sessionId) {
      options.repository.retractSessionEvidence(sessionId, options.clock.now());
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
    setSessionParticipation: unavailable,
    observeConversationTurn: () => ({ status: 'skipped', reason: 'recognition_disabled' }),
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
): Promise<void> {
  if (signal.aborted || canProcess(options, job.sessionId, job.completedAt)) return;
  if (options.sessions.getSession({ session_id: job.sessionId }).status !== 'found') return;
  const committed = options.history.getCommittedRunMessages({
    sessionId: job.sessionId,
    executionId: job.executionId,
  });
  if (committed.status !== 'ok') return;
  const user = committed.messages.find((item) => (
    item.message.message_id === job.userMessageId
    && item.message.message_kind === 'user_message'
  ));
  const assistant = committed.messages.find((item) => (
    item.message.message_id === job.assistantMessageId
    && item.message.message_kind === 'assistant_reply'
    && item.message.status === 'completed'
  ));
  if (!user || !assistant) return;

  const interests = options.repository.listInterests();
  const pendingEvidence = options.repository.listPendingEvidence();
  const resolvedModel = await options.resolveModel();
  if (resolvedModel.status === 'failed' || signal.aborted) return;
  const extracted = InterestExtractionResultSchema.parse(await options.extractor({
    job,
    userText: sessionMessageText(user.message),
    assistantText: sessionMessageText(assistant.message),
    interests,
    pendingEvidence,
    model: resolvedModel.model,
    signal,
  }));
  if (signal.aborted) return;

  const availableInterestIds = new Set(interests.map((interest) => interest.interestId));
  const availableEvidenceIds = new Set(pendingEvidence.map((evidence) => evidence.evidenceId));
  for (const evidence of extracted.evidence) {
    if (evidence.matchedInterestId && !availableInterestIds.has(evidence.matchedInterestId)) {
      throw new Error('Interest extraction returned an unknown Interest ID.');
    }
    if (evidence.supportingEvidenceIds?.some((id) => !availableEvidenceIds.has(id))) {
      throw new Error('Interest extraction returned an unknown Evidence ID.');
    }
  }
  const durable = extracted.evidence.filter((evidence): evidence is typeof evidence & {
    readonly confidence: 'high' | 'medium';
  } => evidence.confidence !== 'low');
  if (durable.length === 0) return;
  options.repository.applyInterestExtraction({
    sessionId: job.sessionId,
    messageId: job.userMessageId,
    now: options.clock.now(),
    evidence: durable.map((evidence) => ({
      evidenceId: options.ids.createEvidenceId(),
      interestId: options.ids.createInterestId(),
      description: evidence.description,
      effect: evidence.effect,
      confidence: evidence.confidence,
      ...(evidence.matchedInterestId ? { matchedInterestId: evidence.matchedInterestId } : {}),
      ...(evidence.supportingEvidenceIds
        ? { supportingEvidenceIds: evidence.supportingEvidenceIds }
        : {}),
    })),
  });
}
