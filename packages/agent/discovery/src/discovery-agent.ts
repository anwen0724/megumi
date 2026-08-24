/* Composes Megumi's discovery business operations with the shared Agent execution service. */
import type { Models } from '@megumi/ai';
import type { ContextCapabilities } from '@megumi/context';
import type { EventBus } from '@megumi/events';
import {
  createAgentExecutions,
  launchAgentExecution,
  type AgentExecutions,
  type DiscoveryAgentPolicy,
  type ExecutionClock,
  type LaunchAgentExecution,
  type ShutdownRequest,
  type ShutdownResult,
} from '@megumi/execution';
import type { ObservabilityService } from '@megumi/observability';
import type { Permissions } from '@megumi/permissions';
import type { SessionHistory } from '@megumi/session';
import type { Tools } from '@megumi/tools';
import {
  createDiscoveryConfiguration,
  type DiscoveryConfigurationStore,
  type DiscoveryConfigurationView,
  type UpdateDiscoveryConfigurationRequest,
} from './configuration/discovery-configuration';
import {
  createConversationSubmission,
  type ConversationSubmissionDependencies,
  type SubmitConversationInputRequest,
  type SubmitConversationInputResult,
} from './conversation/submit-conversation-input';
import type {
  EnsureDailyDiscoveryRequest,
  EnsureDailyDiscoveryResult,
} from './daily-discovery/daily-discovery';
import {
  createDailyDiscoveryRuntime,
  type CreateDailyDiscoveryRuntimeOptions,
} from './daily-discovery/daily-discovery-runtime';
import type {
  DiscoveryHomeView,
  GetDiscoveryHomeRequest,
  RecommendationView,
  SearchRecommendationsRequest,
  SearchRecommendationsResult,
} from './discovery-view';
import type {
  ChangeInterestRequest,
  Interest,
  SessionParticipation,
  SetSessionParticipationRequest,
} from './interests/interest';
import {
  createDisabledInterestRuntime,
  createInterestRuntime,
  type CreateInterestRuntimeOptions,
  type ObserveConversationTurnRequest,
  type ObserveConversationTurnResult,
} from './interests/interest-runtime';
import type { UpdateRecommendationStateRequest } from './recommendations/recommendation';
import type { SourceRegistry } from './sources/source-registry';

export interface DiscoveryAgent extends Omit<AgentExecutions, 'shutdown'> {
  submitConversationInput(request: SubmitConversationInputRequest): Promise<SubmitConversationInputResult>;
  changeInterest(request: ChangeInterestRequest): Promise<Interest>;
  setSessionParticipation(request: SetSessionParticipationRequest): Promise<SessionParticipation>;
  observeConversationTurn(request: ObserveConversationTurnRequest): ObserveConversationTurnResult;
  retractSessionEvidence(sessionId: string): Promise<void>;
  startBackground(): Promise<void>;
  ensureDailyDiscovery(request: EnsureDailyDiscoveryRequest): Promise<EnsureDailyDiscoveryResult>;
  getDiscoveryHome(request: GetDiscoveryHomeRequest): Promise<DiscoveryHomeView>;
  searchRecommendations(request: SearchRecommendationsRequest): Promise<SearchRecommendationsResult>;
  updateRecommendationState(request: UpdateRecommendationStateRequest): Promise<RecommendationView>;
  getDiscoveryConfiguration(): Promise<DiscoveryConfigurationView>;
  updateDiscoveryConfiguration(request: UpdateDiscoveryConfigurationRequest): Promise<DiscoveryConfigurationView>;
  shutdown(request: ShutdownRequest): Promise<ShutdownResult>;
}

export interface CreateDiscoveryAgentOptions {
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
  readonly launch?: LaunchAgentExecution;
}

export function createDiscoveryAgent(options: CreateDiscoveryAgentOptions): DiscoveryAgent {
  validateDiscoveryAgentPolicy(options.policy);
  const interestRuntime = options.interests
    ? createInterestRuntime(options.interests)
    : createDisabledInterestRuntime();
  const launch = options.launch ?? ((input) => launchAgentExecution(input, options));
  const executions = createAgentExecutions({
    ids: options.ids,
    clock: options.clock,
    terminalRetentionMs: options.terminalRetentionMs,
    events: options.events,
    launch,
    onSettled(execution, outcome) {
      if (outcome.status !== 'completed' || !execution.completedAt) return;
      interestRuntime.observeConversationTurn({
        sessionId: execution.sessionId,
        executionId: execution.executionId,
        userMessageId: execution.userMessageId,
        assistantMessageId: outcome.assistantMessageId,
        completedAt: execution.completedAt,
      });
    },
  });
  const conversationSubmission = createConversationSubmission({
    dependencies: {
      ...options.conversation,
      ...(options.dailyDiscovery ? { recommendations: options.dailyDiscovery.repository } : {}),
    },
    startExecution: (request) => executions.start(request),
  });
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

  return {
    ...executions,
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
    async shutdown(request) {
      interestRuntime.shutdown();
      await dailyDiscoveryRuntime?.shutdown();
      return executions.shutdown(request);
    },
  };
}

function validateDiscoveryAgentPolicy(policy: DiscoveryAgentPolicy): void {
  for (const field of ['providerRequestMaxRetries', 'providerRequestMaxRetryDelayMs'] as const) {
    if (!Number.isInteger(policy[field]) || policy[field] < 0) {
      throw new TypeError(`Invalid DiscoveryAgentPolicy.${field}: expected a non-negative integer.`);
    }
  }
}
