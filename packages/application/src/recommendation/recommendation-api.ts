/* Composes Recommendation product operations and validates its external requests. */
import type { Settings } from '../settings/settings-store';
import type { CandidatePoolSnapshot, CandidateSupplyResult, CandidateSupplyTrigger } from './candidates/candidate-pool';
import { candidatePoolSettings } from './candidates/candidate-pool';
import type { CreateCandidatesOptions } from './collection/collect-candidates';
import { createCandidates } from './collection/collect-candidates';
import type { CreateRecommendationsOptions, RequestRecommendationResult, TodayRecommendationResult, WaitRecommendationResult } from './daily/generate-recommendations';
import { createRecommendations } from './daily/generate-recommendations';
import type { Recommendation, RecommendationCollection, UpdateRecommendationStateRequest } from './daily/publish-recommendations';
import type { ChangeInterestRequest, CreateInterestsOptions, Interest, InterestEvidence, InterestSessionSetting, ObserveConversationTurnRequest, ObserveConversationTurnResult, SetInterestSessionSettingRequest } from './interests/interest-catalog';
import { createDisabledInterests, createInterests } from './interests/interest-catalog';
import type { CreatePreferenceLearningOptions, PreferenceLearningStatus, PreparePreferencesRequest, PreparePreferencesResult } from './preferences/preference-learning';
import { createPreferenceLearning } from './preferences/preference-learning';
import type { PreferenceEvidenceView, PreferenceLearningCompletion, PreferenceLearningFacts, PreferenceManagementDetails, PreferenceScopeRequest } from './preferences/preference-rules';
import type { PreferenceDeleteResult, PreferenceEditResult } from './preferences/preference-storage';
import type { DiscoveryHost } from './recommendation-contracts';
import { DiscoveryBackgroundWaitOptionsSchema, DiscoveryCandidateSupplyRequestSchema, DiscoveryFactsResultSchema, DiscoveryInterestFactsPayloadSchema, DiscoveryInterestFactsResultSchema, DiscoveryPreferenceDeletePayloadSchema, DiscoveryPreferenceDetailsPayloadSchema, DiscoveryPreferenceEditPayloadSchema, DiscoveryPreferenceEvidencePayloadSchema, DiscoveryPreferenceLearningQuerySchema, DiscoveryRecommendationFactsQuerySchema } from './recommendation-contracts';
import type { RecommendationReferenceContent } from './recommendation-discussion';
import { recommendationReference } from './recommendation-discussion';
import type { DiscoveryHomeView, GetDiscoveryHomeRequest, SearchRecommendationsRequest, SearchRecommendationsResult } from './recommendation-feed';
import { createRecommendationFeed } from './recommendation-feed';
import type { ConnectDiscoverySourceRequest, DiscoveryConfigurationStore, DiscoveryConfigurationUpdateResult, DiscoveryConfigurationView, DiscoverySourceView, RefreshDiscoverySourceRequest, UpdateDiscoveryConfigurationRequest } from './recommendation-settings';
import { createDiscoveryConfiguration } from './recommendation-settings';
import type { UpdateRecommendationStateResult } from './recommendation-storage';
import type { SourceRegistry } from './sources/source-catalog';
export type { RecommendationReferenceContent } from './recommendation-discussion';

export function createDiscoveryOperations(
  agent: Pick<
    Discovery,
    | 'getPreferenceDetails' | 'getPreferenceEvidence' | 'editPreference' | 'deletePreference' | 'preparePreferencesForRecommendation'
    | 'changeInterest'
    | 'confirmCandidateSupply'
    | 'setInterestSessionSetting'
    | 'requestRecommendation'
    | 'waitRecommendation'
    | 'getTodayRecommendation'
    | 'getRecommendationCollection'
    | 'getRecommendationById'
    | 'getDiscoveryHome'
    | 'searchRecommendations'
    | 'updateRecommendationState'
    | 'getDiscoveryConfiguration'
    | 'updateDiscoveryConfiguration'
    | 'connectDiscoverySource'
    | 'refreshDiscoverySource'
    | 'refreshDiscoverySources'
    | 'getInterestFacts'
    | 'requestCandidateSupply'
    | 'getCandidatePool'
    | 'getPreferenceLearningCompletion'
    | 'getPreferenceLearningStatus' | 'getRecommendationFacts'
  >,
): DiscoveryHost {
  return {
    getPreferenceDetails: async (request) => ({ details: agent.getPreferenceDetails(DiscoveryPreferenceDetailsPayloadSchema.parse(request)) ?? null }),
    getPreferenceEvidence: async (request) => ({ details: agent.getPreferenceEvidence(DiscoveryPreferenceEvidencePayloadSchema.parse(request).preferenceId) ?? null }),
    editPreference: async (request) => agent.editPreference(DiscoveryPreferenceEditPayloadSchema.parse(request)),
    deletePreference: async (request) => agent.deletePreference(DiscoveryPreferenceDeletePayloadSchema.parse(request)),
    preparePreferencesForRecommendation: (request) => agent.preparePreferencesForRecommendation(request),
    confirmCandidateSupply: () => agent.confirmCandidateSupply(),
    getConfiguration: () => agent.getDiscoveryConfiguration(),
    updateConfiguration: (request) => agent.updateDiscoveryConfiguration(request),
    connectSource: (request) => agent.connectDiscoverySource(request),
    refreshSource: (request) => agent.refreshDiscoverySource(request),
    refreshSources: () => agent.refreshDiscoverySources(),
    changeInterest: (request) => agent.changeInterest(request),
    setInterestSessionSetting: (request) => agent.setInterestSessionSetting(request),
    requestRecommendation: (request) => agent.requestRecommendation(request),
    waitRecommendation: (request) => agent.waitRecommendation(request),
    getTodayRecommendation: () => Promise.resolve(agent.getTodayRecommendation()),
    getRecommendationCollection: (request) => Promise.resolve(
      agent.getRecommendationCollection(request.localDate, request.includeHidden) ?? null,
    ),
    getRecommendationById: (request) => Promise.resolve(
      agent.getRecommendationById(request.recommendationId) ?? null,
    ),
    getHome: (request) => agent.getDiscoveryHome(request),
    searchRecommendations: (request) => agent.searchRecommendations(request),
    updateRecommendationState: (request) => agent.updateRecommendationState(request),
    getInterestFacts(request) {
      const result = agent.getInterestFacts(DiscoveryInterestFactsPayloadSchema.parse(request));
      return Promise.resolve(DiscoveryInterestFactsResultSchema.parse(result));
    },
    async requestCandidateSupply(request = { trigger: 'supply_conditions_changed' }) {
      const parsed = DiscoveryCandidateSupplyRequestSchema.parse(request);
      const result = agent.requestCandidateSupply(parsed.trigger);
      if (!result) throw new Error('Candidate Supply is not configured.');
      return result;
    },
    getCandidatePool: () => Promise.resolve(agent.getCandidatePool() ?? null),
    async getRecommendationFacts(request) {
      const result = await agent.getRecommendationFacts(
        DiscoveryRecommendationFactsQuerySchema.parse(request),
      );
      DiscoveryFactsResultSchema.parse(result);
      return result;
    },
    getPreferenceLearning(request) {
      const parsed = DiscoveryPreferenceLearningQuerySchema.parse(request);
      return Promise.resolve(agent.getPreferenceLearningCompletion(parsed.recommendationId) ?? null);
    },
    getPreferenceLearningStatus(request) {
      return Promise.resolve(agent.getPreferenceLearningStatus(DiscoveryPreferenceLearningQuerySchema.parse(request).recommendationId));
    },
    waitPreferenceLearning: (request) => waitForBusinessFact({
      timeoutMs: DiscoveryBackgroundWaitOptionsSchema.parse({ timeoutMs: request.timeoutMs }).timeoutMs,
      read: () => agent.getPreferenceLearningCompletion(
        DiscoveryPreferenceLearningQuerySchema.parse({
          recommendationId: request.recommendationId,
        }).recommendationId,
      ),
      terminal: (value) => value.status === 'learned',
    }),
  };
}

async function waitForBusinessFact<T>(input: {
  readonly timeoutMs: number;
  readonly read: () => T | undefined;
  readonly terminal: (value: T) => boolean;
}): Promise<{ readonly status: 'completed'; readonly value: T; } | { readonly status: 'timed_out'; }> {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() <= deadline) {
    const value = input.read();
    if (value && input.terminal(value)) return { status: 'completed', value };
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(25, input.timeoutMs)));
  }
  return { status: 'timed_out' };
}

export interface InterestFacts {
  readonly interests: readonly Interest[];
  readonly evidence: readonly InterestEvidence[];
}


export interface Discovery {
  getRecommendationFacts(request: { executionId: string; requestId: string; localDate: string; }):
    import('./recommendation-contracts').DiscoveryRecommendationFactsResult;
  /** Reads preferences from the existing interest or exploration scope without learning. */
  getPreferenceDetails(scope: PreferenceScopeRequest): PreferenceManagementDetails | undefined;
  /** Reads current and historical evidence for a visible preference. */
  getPreferenceEvidence(preferenceId: string): PreferenceEvidenceView | undefined;
  /** Saves the user's exact requirement with optimistic concurrency protection. */
  editPreference(request: {
    preferenceId: string;
    expectedRevision: number;
    statement: string;
  }): PreferenceEditResult;
  /** Removes a preference immediately and preserves its deletion boundary. */
  deletePreference(request: {
    preferenceId: string;
    expectedRevision: number;
  }): PreferenceDeleteResult;
  /** Internal recommendation and controlled-evaluation entry; not exposed as a Desktop learning action. */
  preparePreferencesForRecommendation(
    request: PreparePreferencesRequest,
  ): Promise<PreparePreferencesResult>;
  /** Confirms first Candidate Supply use without waiting for the background execution. */
  confirmCandidateSupply(): Promise<{ readonly status: 'confirmed' | 'already_confirmed'; }>;
  changeInterest(request: ChangeInterestRequest): Promise<Interest>;
  /** Updates a Session's participation setting and retracts its Evidence when excluded. */
  setInterestSessionSetting(
    request: SetInterestSessionSettingRequest,
  ): Promise<InterestSessionSetting>;
  observeConversationTurn(request: ObserveConversationTurnRequest): ObserveConversationTurnResult;
  getInterestFacts(request: {
    readonly interestIds: readonly string[];
    readonly evidenceIds: readonly string[];
  }): InterestFacts;
  retractSessionEvidence(sessionId: string): Promise<void>;
  startBackground(options?: { readonly automaticTriggers?: boolean; }): Promise<void>;
  requestRecommendation(request: {
    readonly trigger: 'scheduled' | 'startup_catchup' | 'manual';
  }): Promise<RequestRecommendationResult>;
  waitRecommendation(request: {
    readonly requestId: string;
    readonly timeoutMs: number;
  }): Promise<WaitRecommendationResult>;
  getTodayRecommendation(): TodayRecommendationResult;
  getRecommendationCollection(
    localDate: string,
    includeHidden?: boolean,
  ): RecommendationCollection | undefined;
  getRecommendationById(recommendationId: string): Recommendation | undefined;
  getRecommendationReference(recommendationId: string): RecommendationReferenceContent | undefined;
  requestCandidateSupply(
    trigger?: CandidateSupplyTrigger,
  ): Promise<CandidateSupplyResult> | undefined;
  getCandidatePool(): CandidatePoolSnapshot | undefined;
  /** Supplies Context with this process's current work snapshot, never durable execution history. */
  getActivePreferenceLearningFacts(batchId: string): PreferenceLearningFacts | undefined;
  getPreferenceLearningCompletion(
    recommendationId: string,
  ): PreferenceLearningCompletion | undefined;
  getPreferenceLearningStatus(recommendationId: string): PreferenceLearningStatus;
  getDiscoveryHome(request: GetDiscoveryHomeRequest): Promise<DiscoveryHomeView>;
  searchRecommendations(
    request: SearchRecommendationsRequest,
  ): Promise<SearchRecommendationsResult>;
  updateRecommendationState(
    request: UpdateRecommendationStateRequest,
  ): Promise<UpdateRecommendationStateResult>;
  getDiscoveryConfiguration(): Promise<DiscoveryConfigurationView>;
  updateDiscoveryConfiguration(
    request: UpdateDiscoveryConfigurationRequest,
  ): Promise<DiscoveryConfigurationUpdateResult>;
  connectDiscoverySource(request: ConnectDiscoverySourceRequest): Promise<DiscoverySourceView>;
  refreshDiscoverySource(request: RefreshDiscoverySourceRequest): Promise<DiscoverySourceView>;
  refreshDiscoverySources(): Promise<DiscoveryConfigurationView>;
  shutdown(): Promise<void>;
}

export interface CreateDiscoveryOptions {
  /** Reuses an externally prepared result at the admitted recommendation boundary. */
  readonly consumePreparedPreferences?: () => PreparePreferencesResult | undefined;
  readonly interests?: CreateInterestsOptions;
  readonly recommendation?: CreateRecommendationsOptions;
  readonly candidateSupply?: CreateCandidatesOptions;
  readonly preferenceLearning?: CreatePreferenceLearningOptions;
  readonly configuration?: {
    readonly sourceRegistry: SourceRegistry;
    readonly settings: DiscoveryConfigurationStore;
  };
  readonly onBackgroundError?: (
    error: unknown,
    context: {
      readonly operation:
      | 'source_refresh'
      | 'candidate_supply_start'
      | 'preference_learning_start'
      | 'recommendation_start';
    },
  ) => void;
}

/** Composes Megumi's Discovery business operations from optional capabilities. */
export function createDiscovery(options: CreateDiscoveryOptions): Discovery {
  const preferenceLearning = options.preferenceLearning
    ? createPreferenceLearning(options.preferenceLearning)
    : undefined;
  const recommendation = options.recommendation
    ? createRecommendations({
      ...options.recommendation,
      ...(preferenceLearning
        ? {
          preparePreferences: async (request) =>
            options.consumePreparedPreferences?.() ??
            preferenceLearning.preparePreferencesForRecommendation(request),
        }
        : {}),
    })
    : undefined;
  const candidateSupply = options.candidateSupply
    ? createCandidates(options.candidateSupply)
    : undefined;
  const interests = options.interests
    ? createInterests({
      ...options.interests,
      onInterestsChanged: (interestIds) => {
        options.interests?.onInterestsChanged?.(interestIds);
        requestCandidateSupply(candidateSupply, 'interest_changed', options);
      },
    })
    : createDisabledInterests();
  const configuration = options.configuration
    ? createDiscoveryConfiguration(options.configuration)
    : undefined;

  const recommendationRepository = options.recommendation?.repository;
  const feed = createRecommendationFeed({
    repository: recommendationRepository, interests: options.interests?.repository,
    candidateSupply, settings: options.candidateSupply?.settings, recommendation,
    notifyReactionChanged: () => preferenceLearning?.notifyReactionChanged(),
  });
  return {
    getPreferenceDetails: (scope) =>
      options.preferenceLearning?.repository.getPreferenceDetails(scope),
    getPreferenceEvidence: (id) => options.preferenceLearning?.repository.getPreferenceEvidence(id),
    editPreference(request) {
      if (!options.preferenceLearning) throw new Error('Preference Learning is not configured.');
      return options.preferenceLearning.repository.editPreference({
        ...request,
        now: options.preferenceLearning.now(),
      });
    },
    deletePreference(request) {
      if (!options.preferenceLearning) throw new Error('Preference Learning is not configured.');
      return options.preferenceLearning.repository.deletePreference({
        ...request,
        now: options.preferenceLearning.now(),
      });
    },
    preparePreferencesForRecommendation(request) {
      if (!preferenceLearning) throw new Error('Preference Learning is not configured.');
      return preferenceLearning.preparePreferencesForRecommendation(request);
    },
    async confirmCandidateSupply() {
      if (!candidateSupply) throw new Error('Candidate Supply is not configured.');
      return candidateSupply.confirm();
    },
    async changeInterest(request) {
      const interest = await interests.changeInterest(request);
      requestCandidateSupply(candidateSupply, 'interest_changed', options);
      return interest;
    },
    setInterestSessionSetting: (request) => interests.setInterestSessionSetting(request),
    observeConversationTurn: (request) => interests.observeConversationTurn(request),
    getInterestFacts: (request) => interests.getInterestFacts(request),
    retractSessionEvidence: (sessionId) => interests.retractSessionEvidence(sessionId),
    async startBackground(startOptions = {}) {
      const automaticTriggers = startOptions.automaticTriggers ?? true;
      const failures: unknown[] = [];
      await runBackgroundStep(options, failures, 'source_refresh', async () => {
        if (!configuration) return;
        const view = await configuration.get();
        await configuration.refreshSources(
          view.sources.filter(({ enabled }) => enabled).map(({ sourceId }) => sourceId),
        );
      });
      await runBackgroundStep(options, failures, 'candidate_supply_start', async () => {
        await candidateSupply?.start({ automaticTriggers });
      });
      await runBackgroundStep(options, failures, 'preference_learning_start', async () => {
        await preferenceLearning?.start({ automaticTriggers });
      });
      await runBackgroundStep(options, failures, 'recommendation_start', async () => {
        await recommendation?.start({ automaticTriggers });
      });
      if (failures.length > 0)
        throw new AggregateError(failures, 'Discovery background startup failed.');
    },
    requestRecommendation: (request) =>
      recommendation
        ? recommendation.generate(request)
        : Promise.resolve({
          status: 'failed',
          localDate: new Date().toISOString().slice(0, 10),
          failure: {
            code: 'settings_invalid',
            message: 'Recommendation is not configured.',
            retryable: false,
          },
        }),
    waitRecommendation: (request) =>
      recommendation
        ? recommendation.wait(request)
        : Promise.resolve({
          status: 'failed',
          localDate: new Date().toISOString().slice(0, 10),
          failure: {
            code: 'settings_invalid',
            message: 'Recommendation is not configured.',
            retryable: false,
          },
        }),
    getRecommendationFacts: (request) => recommendation?.getFacts(request) ?? {
      status: 'failed', failure: { code: 'recommendation_attempt_not_found', message: 'Recommendation is not configured.' },
    },
    getTodayRecommendation: () =>
      recommendation
        ? recommendation.getToday()
        : { status: 'not_generated', localDate: new Date().toISOString().slice(0, 10) },
    getRecommendationCollection: (localDate, includeHidden = false) =>
      recommendationRepository?.getCollection(localDate, includeHidden),
    getRecommendationById: (recommendationId) =>
      recommendationRepository?.findRecommendationById(recommendationId),
    getRecommendationReference(recommendationId) {
      const item = recommendationRepository?.findRecommendationById(recommendationId);
      return item ? recommendationReference(item) : undefined;
    },
    requestCandidateSupply: (trigger = 'supply_conditions_changed') =>
      candidateSupply?.ensureSupply(trigger),
    getCandidatePool: () => {
      if (!options.candidateSupply) return undefined;
      const settings = readConfiguration(options.candidateSupply.settings).discovery;
      return options.candidateSupply.repository.getCandidatePoolSnapshot(
        candidatePoolSettings({
          minimumCount: settings.candidatePoolMinimumCount,
          maximumCount: settings.candidatePoolMaximumCount,
          candidateValidityDays: settings.candidateValidityDays,
          candidateContentExcerptMaxCharacters: settings.candidateContentExcerptMaxCharacters,
        }),
      );
    },
    getActivePreferenceLearningFacts: (id) =>
      preferenceLearning?.getActivePreferenceLearningFacts(id),
    getPreferenceLearningCompletion: (id) =>
      options.preferenceLearning?.repository.getPreferenceLearningCompletion(id),
    getPreferenceLearningStatus: (id) =>
      preferenceLearning?.getPreferenceLearningStatus(id) ?? { status: 'idle' },
    getDiscoveryHome: feed.getHome,
    searchRecommendations: feed.search,
    updateRecommendationState: feed.updateState,
    getDiscoveryConfiguration: () =>
      configuration
        ? configuration.get()
        : Promise.reject(new Error('Discovery configuration is not configured.')),
    async updateDiscoveryConfiguration(request) {
      if (!configuration) throw new Error('Discovery configuration is not configured.');
      const view = await configuration.update(request);
      try {
        recommendation?.updateSchedule();
        candidateSupply?.updateSchedule();
      } catch (error) {
        return {
          ...view,
          scheduling: {
            status: 'failed',
            error: {
              code: 'DISCOVERY_SCHEDULE_FAILED',
              message: error instanceof Error ? error.message : String(error),
            },
          },
        };
      }
      requestCandidateSupply(candidateSupply, 'supply_conditions_changed', options);
      return { ...view, scheduling: { status: 'applied' } };
    },
    async connectDiscoverySource(request) {
      if (!configuration) throw new Error('Discovery configuration is not configured.');
      const view = await configuration.connectSource(request);
      requestCandidateSupply(candidateSupply, 'supply_conditions_changed', options);
      return view;
    },
    async refreshDiscoverySource(request) {
      if (!configuration) throw new Error('Discovery configuration is not configured.');
      const view = await configuration.refreshSource(request);
      requestCandidateSupply(candidateSupply, 'supply_conditions_changed', options);
      return view;
    },
    async refreshDiscoverySources() {
      if (!configuration) throw new Error('Discovery configuration is not configured.');
      const view = await configuration.refreshSources();
      requestCandidateSupply(candidateSupply, 'supply_conditions_changed', options);
      return view;
    },
    async shutdown() {
      await Promise.all([
        interests.shutdown(),
        recommendation?.shutdown() ?? Promise.resolve(),
        candidateSupply?.shutdown() ?? Promise.resolve(),
        preferenceLearning?.shutdown() ?? Promise.resolve(),
      ]);
    },
  };
}


async function runBackgroundStep(
  options: CreateDiscoveryOptions,
  failures: unknown[],
  operation: Parameters<NonNullable<CreateDiscoveryOptions['onBackgroundError']>>[1]['operation'],
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    failures.push(error);
    try {
      options.onBackgroundError?.(error, { operation });
    } catch {
      // A diagnostic observer cannot change independent startup behavior.
    }
  }
}

function requestCandidateSupply(
  runtime: ReturnType<typeof createCandidates> | undefined,
  trigger: CandidateSupplyTrigger,
  options: CreateDiscoveryOptions,
): void {
  if (!runtime) return;
  void runtime.ensureSupply(trigger).catch((error) => {
    try {
      options.onBackgroundError?.(error, { operation: 'candidate_supply_start' });
    } catch {
      // A diagnostic observer cannot change Candidate Supply behavior.
    }
  });
}

function readConfiguration(settings: Pick<Settings, 'readSettings'>) {
  const result = settings.readSettings();
  if (result.status === 'rejected') throw new Error(result.error.message);
  return result.settings.config;
}
