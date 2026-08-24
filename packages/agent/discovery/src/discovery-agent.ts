/*
 * Implements the public Discovery Agent operations: start with request-id
 * idempotency and per-Session exclusion, approval resolution, cancellation,
 * reads, and shutdown. It owns the Execution Registry and the run.* lifecycle
 * events, but never a second Agent Loop: the Execute Agent adapter constructs
 * the Agent, and the single Agent Execution starts only after run.started.
 */
import type { Agent } from '@megumi/agent-core';
import type { Api, Model, Models } from '@megumi/ai';
import type { ContextCapabilities } from '@megumi/context';
import type { EventBus, EventPayloadByType, EventType } from '@megumi/events';
import type { UserInput } from '@megumi/input';
import type { ObservabilityService } from '@megumi/observability';
import type {
  ApprovalDecision,
  PermissionMode,
  Permissions,
} from '@megumi/permissions';
import type { RecommendationReferenceContent, SessionEntry, SessionHistory, SessionMessageWithAttachments } from '@megumi/session';
import type { Tools } from '@megumi/tools';
import {
  createConversationSubmission,
  type ConversationSubmissionDependencies,
  type SubmitConversationInputRequest,
  type SubmitConversationInputResult,
} from './conversation/submit-conversation-input';
import {
  createDisabledInterestRuntime,
  createInterestRuntime,
  type CreateInterestRuntimeOptions,
  type ObserveConversationTurnRequest,
  type ObserveConversationTurnResult,
} from './interests/interest-runtime';
import type {
  ChangeInterestRequest,
  Interest,
  SessionParticipation,
  SetSessionParticipationRequest,
} from './interests/interest';
import {
  createDailyDiscoveryRuntime,
  type CreateDailyDiscoveryRuntimeOptions,
} from './daily-discovery/daily-discovery-runtime';
import {
  createDiscoveryConfiguration,
  type DiscoveryConfigurationStore,
  type DiscoveryConfigurationView,
  type UpdateDiscoveryConfigurationRequest,
} from './configuration/discovery-configuration';
import type { SourceRegistry } from './sources/source-registry';
import type {
  EnsureDailyDiscoveryRequest,
  EnsureDailyDiscoveryResult,
} from './daily-discovery/daily-discovery';
import type {
  DiscoveryHomeView,
  GetDiscoveryHomeRequest,
  RecommendationView,
  SearchRecommendationsRequest,
  SearchRecommendationsResult,
} from './discovery-view';
import type { UpdateRecommendationStateRequest } from './recommendations/recommendation';
import {
  LaunchExecutionError,
  launchAgentExecution,
  type DiscoveryAgentPolicy,
} from './execution/execute-agent';
import {
  ExecutionRegistry,
  type ApprovalRequest,
  type ApprovalResolution,
  type ExecutionClock,
  type ExecutionFailure,
  type ExecutionMetadata,
  type ExecutionOutcome,
  type ExecutionSnapshot,
} from './execution/execution-registry';

// ---------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------

export interface DiscoveryAgent {
  submitConversationInput(
    request: SubmitConversationInputRequest,
  ): Promise<SubmitConversationInputResult>;
  changeInterest(request: ChangeInterestRequest): Promise<Interest>;
  setSessionParticipation(
    request: SetSessionParticipationRequest,
  ): Promise<SessionParticipation>;
  observeConversationTurn(request: ObserveConversationTurnRequest): ObserveConversationTurnResult;
  retractSessionEvidence(sessionId: string): Promise<void>;
  startBackground(): Promise<void>;
  ensureDailyDiscovery(request: EnsureDailyDiscoveryRequest): Promise<EnsureDailyDiscoveryResult>;
  getDiscoveryHome(request: GetDiscoveryHomeRequest): Promise<DiscoveryHomeView>;
  searchRecommendations(request: SearchRecommendationsRequest): Promise<SearchRecommendationsResult>;
  updateRecommendationState(request: UpdateRecommendationStateRequest): Promise<RecommendationView>;
  getDiscoveryConfiguration(): Promise<DiscoveryConfigurationView>;
  updateDiscoveryConfiguration(request: UpdateDiscoveryConfigurationRequest): Promise<DiscoveryConfigurationView>;
  start(request: StartExecutionRequest): Promise<StartExecutionResult>;
  resolveApproval(request: ResolveApprovalRequest): Promise<ResolveApprovalResult>;
  cancel(request: CancelExecutionRequest): Promise<CancelExecutionResult>;
  get(request: GetExecutionRequest): GetExecutionResult;
  /** Reads the one current execution for a Session from registry state. */
  getActive(request: GetActiveExecutionRequest): GetActiveExecutionResult;
  shutdown(request: ShutdownRequest): Promise<ShutdownResult>;
}

export interface StartExecutionRequest {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly parentEntryId?: string;
  readonly input: UserInput;
  readonly recommendationReference?: RecommendationReferenceContent;
  readonly model: Model<Api>;
  readonly permissionMode: PermissionMode;
}

export type StartExecutionResult =
  | {
      readonly status: 'started';
      readonly execution: ExecutionSnapshot;
      readonly userMessage: SessionMessageWithAttachments;
      readonly userEntry: SessionEntry;
    }
  | {
      readonly status: 'already_started';
      readonly execution: ExecutionSnapshot;
      readonly userMessage: SessionMessageWithAttachments;
      readonly userEntry: SessionEntry;
    }
  | {
      readonly status: 'session_busy';
      readonly activeExecution: ExecutionSnapshot;
    }
  | {
      readonly status: 'failed';
      readonly failure: ExecutionFailure;
    };

export interface ResolveApprovalRequest {
  readonly approvalId: string;
  readonly decision: ApprovalDecisionRequest;
}

export type ApprovalDecisionRequest =
  | {
      readonly decision: 'approved';
      readonly optionId: string;
      readonly reason?: string;
    }
  | {
      readonly decision: 'denied';
      readonly reason?: string;
    };

export type ResolveApprovalResult =
  | { readonly status: 'accepted'; readonly execution: ExecutionSnapshot }
  | { readonly status: 'not_found'; readonly approvalId: string }
  | { readonly status: 'not_waiting'; readonly approvalId: string; readonly execution: ExecutionSnapshot }
  | { readonly status: 'already_resolved'; readonly approvalId: string; readonly execution: ExecutionSnapshot }
  | { readonly status: 'failed'; readonly failure: ExecutionFailure };

export interface CancelExecutionRequest {
  readonly executionId: string;
}

export type CancelExecutionResult =
  | { readonly status: 'cancellation_requested'; readonly execution: ExecutionSnapshot }
  | { readonly status: 'already_cancelling'; readonly execution: ExecutionSnapshot }
  | { readonly status: 'already_terminal'; readonly execution: ExecutionSnapshot }
  | { readonly status: 'not_found'; readonly executionId: string };

export interface GetExecutionRequest {
  readonly executionId: string;
}

export type GetExecutionResult =
  | { readonly status: 'found'; readonly execution: ExecutionSnapshot }
  | { readonly status: 'not_found'; readonly executionId: string };

export interface GetActiveExecutionRequest {
  readonly sessionId: string;
}

export type GetActiveExecutionResult =
  | { readonly status: 'found'; readonly execution: ExecutionSnapshot }
  | { readonly status: 'not_found'; readonly sessionId: string };

export interface ShutdownRequest {
  readonly timeoutMs: number;
}

export type ShutdownResult =
  | { readonly status: 'shut_down' }
  | { readonly status: 'timed_out'; readonly activeExecutions: readonly ExecutionSnapshot[] };

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * The launch seam establishes one execution: the User Message commit, the Agent
 * construction and its adapters. `execute()` then starts the single Agent
 * Execution after the Discovery Agent published run.started.
 */
export interface LaunchAgentExecutionInput {
  readonly metadata: ExecutionMetadata;
  readonly input: UserInput;
  readonly recommendationReference?: RecommendationReferenceContent;
  readonly awaitApproval: (request: { readonly approval: ApprovalRequest }) => Promise<ApprovalResolution>;
}

export interface LaunchedAgentExecution {
  readonly agent: Agent;
  readonly userMessage: SessionMessageWithAttachments;
  readonly userEntry: SessionEntry;
  /** Starts the single Agent Execution; resolves with the settled ExecutionOutcome. */
  readonly execute: () => Promise<ExecutionOutcome>;
}

export type LaunchAgentExecution = (input: LaunchAgentExecutionInput) => Promise<LaunchedAgentExecution>;

export interface CreateDiscoveryAgentOptions {
  /** The ID creation capabilities the execution base needs; never exported as an object. */
  readonly ids: {
    createExecutionId(): string;
    createSessionMessageId(): string;
    createModelCallId(): string;
    createToolExecutionId(): string;
    createApprovalId(): string;
  };
  readonly clock: ExecutionClock;
  readonly terminalRetentionMs: number;
  readonly events: EventBus;
  readonly models: Models;
  readonly context: ContextCapabilities;
  readonly tools: Pick<Tools, 'bindExecution'>;
  readonly permissions: Pick<Permissions, 'evaluateToolCall' | 'applyApprovalDecision'>;
  readonly session: Pick<
    SessionHistory,
    'saveUserMessage' | 'saveModelResponse' | 'saveAssistantReply' | 'saveToolResultMessage'
  >;
  readonly conversation: ConversationSubmissionDependencies;
  readonly interests?: CreateInterestRuntimeOptions;
  readonly dailyDiscovery?: Omit<CreateDailyDiscoveryRuntimeOptions, 'tools'>;
  readonly configuration?: {
    readonly sourceRegistry: SourceRegistry;
    readonly settings: DiscoveryConfigurationStore;
  };
  readonly observability?: ObservabilityService;
  readonly policy: DiscoveryAgentPolicy;
  /** Optional launch override for focused multi-execution tests; production uses the Execute Agent adapter. */
  readonly launch?: LaunchAgentExecution;
}

export function createDiscoveryAgent(options: CreateDiscoveryAgentOptions): DiscoveryAgent {
  validateDiscoveryAgentPolicy(options.policy);
  const store = new ExecutionRegistry({
    clock: options.clock,
    terminalRetentionMs: options.terminalRetentionMs,
  });
  const launch = options.launch ?? ((input) => launchAgentExecution(input, options));
  let accepting = true;
  let operations!: DiscoveryAgent;
  const conversationSubmission = createConversationSubmission({
    dependencies: {
      ...options.conversation,
      ...(options.dailyDiscovery ? { recommendations: options.dailyDiscovery.repository } : {}),
    },
    startExecution: (request) => operations.start(request),
  });
  const interestRuntime = options.interests
    ? createInterestRuntime(options.interests)
    : createDisabledInterestRuntime();
  const dailyDiscoveryRuntime = options.dailyDiscovery
    ? createDailyDiscoveryRuntime({
        ...options.dailyDiscovery,
        tools: options.tools,
        models: options.models,
        createExecutionId: options.ids.createExecutionId,
        now: options.clock.now,
      })
    : undefined;
  const discoveryConfiguration = options.configuration
    ? createDiscoveryConfiguration(options.configuration)
    : undefined;

  const settleCompletion = (executionId: string, outcome: ExecutionOutcome): void => {
    try {
      store.settleTerminal(executionId, outcome);
      const terminal = store.getExecution(executionId);
      if (terminal) {
        publishEnded(terminal, outcome);
        if (outcome.status === 'completed' && terminal.completedAt) {
          interestRuntime.observeConversationTurn({
            sessionId: terminal.sessionId,
            executionId: terminal.executionId,
            userMessageId: terminal.userMessageId,
            assistantMessageId: outcome.assistantMessageId,
            completedAt: terminal.completedAt,
          });
        }
      }
    } catch (error) {
      // Terminal settlement must never change the fixed result or reject; the
      // failure is a diagnostics-only invariant violation.
      void error;
    }
  };

  const publish = <TType extends EventType>(
    execution: ExecutionSnapshot,
    type: TType,
    payload: EventPayloadByType[TType],
    omitExecutionId = false,
  ): void => {
    options.events.publish({
      type,
      payload,
      sessionId: execution.sessionId,
      ...(omitExecutionId ? {} : { executionId: execution.executionId }),
    });
  };

  const publishEnded = (execution: ExecutionSnapshot, outcome: ExecutionOutcome): void => {
    if (outcome.status === 'completed') {
      publish(execution, 'run.ended', {
        status: 'completed',
        assistantMessageId: outcome.assistantMessageId,
      });
      return;
    }
    if (outcome.status === 'failed') {
      publish(execution, 'run.ended', {
        status: 'failed',
        error: {
          message: outcome.failure.message,
          code: outcome.failure.code,
          retryable: outcome.failure.retryable,
          ...(outcome.failure.cause ? { cause: { ...outcome.failure.cause } } : {}),
        },
      });
      return;
    }
    publish(execution, 'run.ended', { status: 'cancelled' });
  };

  const requestCancellation = async (executionId: string): Promise<CancelExecutionResult> => {
    const current = store.getExecution(executionId);
    if (!current) return { status: 'not_found', executionId };
    if (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled') {
      return { status: 'already_terminal', execution: current };
    }
    if (current.status === 'cancelling') {
      return { status: 'already_cancelling', execution: current };
    }
    // A pending approval wait must settle as cancelled before the Agent abort
    // fires so the single Agent Loop wakes and converges in place.
    store.cancelPendingApproval(executionId);
    const active = store.getActiveExecutionHandle(executionId);
    active?.agent.abort();
    publish(current, 'run.cancel.requested', {
      requestedBy: 'user',
      reason: 'user_cancelled',
      scope: 'run',
    });
    const cancelling = store.getExecution(executionId);
    return {
      status: 'cancellation_requested',
      execution: cancelling ?? current,
    };
  };

  operations = {
    submitConversationInput: (request) => conversationSubmission.submit(request),
    changeInterest: (request) => interestRuntime.changeInterest(request),
    setSessionParticipation: (request) => interestRuntime.setSessionParticipation(request),
    observeConversationTurn: (request) => interestRuntime.observeConversationTurn(request),
    retractSessionEvidence: (sessionId) => interestRuntime.retractSessionEvidence(sessionId),
    startBackground: () => dailyDiscoveryRuntime?.start() ?? Promise.resolve(),
    ensureDailyDiscovery: (request) => dailyDiscoveryRuntime
      ? dailyDiscoveryRuntime.ensure(request)
      : Promise.resolve({
          status: 'failed',
          localDate: request.now.slice(0, 10),
          failure: {
            code: 'daily_discovery_not_configured',
            message: 'Daily discovery is not configured.',
            retryable: false,
          },
        }),
    getDiscoveryHome: (request) => dailyDiscoveryRuntime
      ? Promise.resolve(dailyDiscoveryRuntime.getHome(request))
      : Promise.reject(new Error('Daily discovery is not configured.')),
    searchRecommendations: (request) => dailyDiscoveryRuntime
      ? Promise.resolve(dailyDiscoveryRuntime.searchRecommendations(request))
      : Promise.reject(new Error('Daily discovery is not configured.')),
    updateRecommendationState: (request) => dailyDiscoveryRuntime
      ? Promise.resolve(dailyDiscoveryRuntime.updateRecommendationState(request))
      : Promise.reject(new Error('Daily discovery is not configured.')),
    getDiscoveryConfiguration: () => discoveryConfiguration
      ? discoveryConfiguration.get()
      : Promise.reject(new Error('Discovery configuration is not configured.')),
    updateDiscoveryConfiguration: (request) => discoveryConfiguration
      ? discoveryConfiguration.update(request)
      : Promise.reject(new Error('Discovery configuration is not configured.')),

    async start(request): Promise<StartExecutionResult> {
      if (!accepting) {
        return {
          status: 'failed',
          failure: shuttingDownFailure('Discovery Agent is shutting down and is not accepting new executions.'),
        };
      }
      const createdAt = options.clock.now();
      const executionId = options.ids.createExecutionId();
      const userMessageId = options.ids.createSessionMessageId();
      const metadata: ExecutionMetadata = {
        executionId,
        requestId: request.requestId,
        workspaceId: request.workspaceId,
        sessionId: request.sessionId,
        ...(request.parentEntryId ? { parentEntryId: request.parentEntryId } : {}),
        userMessageId,
        model: request.model,
        permissionMode: request.permissionMode,
        createdAt,
        startedAt: createdAt,
      };
      const reserved = store.reserveStart({
        requestId: request.requestId,
        fingerprint: {
          workspaceId: request.workspaceId,
          sessionId: request.sessionId,
          ...(request.parentEntryId ? { parentEntryId: request.parentEntryId } : {}),
          inputDigest: canonicalJson({
            input: request.input,
            ...(request.recommendationReference
              ? { recommendationReference: request.recommendationReference }
              : {}),
          }),
        },
        metadata,
      });
      if (reserved.status === 'pending') {
        const completion = await reserved.completion;
        return completion.status === 'started'
          ? {
              status: 'already_started',
              execution: completion.result.execution,
              userMessage: completion.result.userMessage,
              userEntry: completion.result.userEntry,
            }
          : { status: 'failed', failure: completion.failure };
      }
      if (reserved.status === 'already_started') {
        return {
          status: 'already_started',
          execution: reserved.result.execution,
          userMessage: reserved.result.userMessage,
          userEntry: reserved.result.userEntry,
        };
      }
      if (reserved.status === 'request_conflict') {
        return {
          status: 'failed',
          failure: {
            code: 'runtime_protocol_violation',
            message: 'requestId was reused with different execution input.',
            retryable: false,
            cause: { owner: 'discovery-agent', code: 'request_id_conflict' },
          },
        };
      }
      if (reserved.status === 'session_busy') {
        return { status: 'session_busy', activeExecution: reserved.activeExecution };
      }

      // The launch establishes the execution: the User Message commits and the
      // Agent is constructed with its adapters, without starting the Loop yet.
      let launched: LaunchedAgentExecution;
      try {
        launched = await launch({
          metadata,
          input: request.input,
          ...(request.recommendationReference
            ? { recommendationReference: request.recommendationReference }
            : {}),
          awaitApproval: (approvalRequest) => store.beginApprovalWait({
            executionId,
            approval: approvalRequest.approval,
          }),
        });
      } catch (error) {
        const failure: ExecutionFailure = error instanceof LaunchExecutionError
          ? error.failure
          : {
              code: 'internal_error',
              message: error instanceof Error ? error.message : 'Execution launch failed.',
              retryable: false,
              cause: { owner: 'discovery-agent', code: 'launch_failed' },
            };
        store.failStart({ requestId: request.requestId, failure });
        return { status: 'failed', failure };
      }

      let resolveCompletion!: (outcome: ExecutionOutcome) => void;
      const completion = new Promise<ExecutionOutcome>((resolve) => {
        resolveCompletion = resolve;
      });
      store.attachActiveExecution({
        metadata,
        agent: launched.agent,
        completion,
        pendingApproval: undefined,
      });
      // The unique Agent Execution settles the active record on every path.
      void completion.then((outcome) => settleCompletion(executionId, outcome));
      store.completeStart({
        requestId: request.requestId,
        executionId,
        userMessage: launched.userMessage,
        userEntry: launched.userEntry,
      });

      const execution = store.getExecution(executionId)!;
      // The user message is the execution's input: it precedes run.started and
      // carries no executionId (ordering contract, see events/CONTEXT.md).
      publish(execution, 'message.started', {
        role: 'user',
        messageId: userMessageId,
      }, true);
      publish(execution, 'message.ended', {
        role: 'user',
        messageId: userMessageId,
        content: userMessageText(request.input),
      }, true);
      publish(execution, 'run.started', {
        requestId: execution.requestId,
        providerId: String(execution.model.provider),
        modelId: execution.model.id,
      });

      // The single Agent Execution starts only after run.started was published.
      void launched.execute().then(
        resolveCompletion,
        () => resolveCompletion({
          status: 'failed',
          failure: {
            code: 'internal_error',
            message: 'Execution failed unexpectedly.',
            retryable: false,
            cause: { owner: 'discovery-agent', code: 'unexpected_exception' },
          },
        }),
      );

      return {
        status: 'started',
        execution,
        userMessage: launched.userMessage,
        userEntry: launched.userEntry,
      };
    },

    async resolveApproval(request): Promise<ResolveApprovalResult> {
      const resolved = store.resolveApproval({
        approvalId: request.approvalId,
        decision: toApprovalDecision(request.decision, request.approvalId, options.clock.now()),
      });
      if (resolved.status === 'accepted') return { status: 'accepted', execution: resolved.execution };
      if (resolved.status === 'not_found') return { status: 'not_found', approvalId: request.approvalId };
      if (resolved.status === 'not_waiting') {
        return { status: 'not_waiting', approvalId: request.approvalId, execution: resolved.execution };
      }
      return { status: 'already_resolved', approvalId: request.approvalId, execution: resolved.execution };
    },

    async cancel(request): Promise<CancelExecutionResult> {
      return requestCancellation(request.executionId);
    },

    get(request): GetExecutionResult {
      const execution = store.getExecution(request.executionId);
      return execution
        ? { status: 'found', execution }
        : { status: 'not_found', executionId: request.executionId };
    },

    getActive(request): GetActiveExecutionResult {
      const execution = store.getActive(request.sessionId);
      return execution
        ? { status: 'found', execution }
        : { status: 'not_found', sessionId: request.sessionId };
    },

    async shutdown(request): Promise<ShutdownResult> {
      accepting = false;
      interestRuntime.shutdown();
      await dailyDiscoveryRuntime?.shutdown();
      await Promise.allSettled(
        store.listActiveExecutions().map((execution) => requestCancellation(execution.executionId)),
      );
      const idle = await store.waitForIdle(request.timeoutMs);
      return idle
        ? { status: 'shut_down' }
        : { status: 'timed_out', activeExecutions: store.listActiveExecutions() };
    },
  };
  return operations;
}

/** The Discovery Agent validates the policy facts it owns; the Agent validates its own limits. */
function validateDiscoveryAgentPolicy(policy: DiscoveryAgentPolicy): void {
  for (const field of ['providerRequestMaxRetries', 'providerRequestMaxRetryDelayMs'] as const) {
    if (!Number.isInteger(policy[field]) || policy[field] < 0) {
      throw new TypeError(`Invalid DiscoveryAgentPolicy.${field}: expected a non-negative integer.`);
    }
  }
}

function toApprovalDecision(
  decision: ApprovalDecisionRequest,
  approvalId: string,
  decidedAt: string,
): ApprovalDecision {
  return decision.decision === 'approved'
    ? {
        approvalRequestId: approvalId,
        decision: 'approved',
        optionId: decision.optionId,
        decidedBy: 'user',
        decidedAt,
        ...(decision.reason ? { reason: decision.reason } : {}),
      }
    : {
        approvalRequestId: approvalId,
        decision: 'denied',
        decidedBy: 'user',
        decidedAt,
        ...(decision.reason ? { reason: decision.reason } : {}),
      };
}

function userMessageText(input: UserInput): string {
  return input.displayContent
    .map((block) => block.type === 'text' ? block.text : '')
    .join('');
}

/** Stable canonical serialization for request-id idempotency fingerprints. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function shuttingDownFailure(message: string): ExecutionFailure {
  return {
    code: 'internal_error',
    message,
    retryable: false,
    cause: { owner: 'discovery-agent', code: 'discovery_agent_shutting_down' },
  };
}
