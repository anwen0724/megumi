/*
 * Composes Discovery business owners while keeping Agent Core as the sole
 * execution-lifecycle owner and repositories behind public business methods.
 */
import { candidatePoolSettings } from './candidate-supply/candidate-pool';
import {
  createCandidateSupplyRuntime,
  type CreateCandidateSupplyRuntimeOptions,
} from './candidate-supply/candidate-supply-runtime';
import type {
  CandidatePoolSnapshot,
  CandidateSupplyResult,
  CandidateSupplyTrigger,
} from './candidate-supply/candidate-supply';
import {
  createDiscoveryConfiguration,
  type ConnectDiscoverySourceRequest,
  type DiscoveryConfigurationStore,
  type DiscoveryConfigurationView,
  type DiscoverySourceView,
  type RefreshDiscoverySourceRequest,
  type UpdateDiscoveryConfigurationRequest,
} from './configuration/discovery-configuration';
import {
  DiscoveryHomeViewSchema,
  GetDiscoveryHomeRequestSchema,
  SearchRecommendationsRequestSchema,
  SearchRecommendationsResultSchema,
  type DiscoveryHomeView,
  type GetDiscoveryHomeRequest,
  type RecommendationView,
  type SearchRecommendationsRequest,
  type SearchRecommendationsResult,
} from './discovery-view';
import type {
  ChangeInterestRequest,
  Interest,
  InterestEvidence,
  InterestSessionSetting,
  SetInterestSessionSettingRequest,
} from './interests/interest';
import {
  createDisabledInterestRuntime,
  createInterestRuntime,
  type CreateInterestRuntimeOptions,
  type ObserveConversationTurnRequest,
  type ObserveConversationTurnResult,
} from './interests/interest-runtime';
import {
  createPreferenceLearningRuntime,
  type CreatePreferenceLearningRuntimeOptions,
} from './preferences/preference-learning-runtime';
import type { PreferenceLearningFacts, PreferenceLearningCompletion } from './preferences/preference';
import type {
  Recommendation,
  RecommendationCollection,
  UpdateRecommendationStateRequest,
} from './recommendation/recommendation';
import {
  createRecommendationRuntime,
  type CreateRecommendationRuntimeOptions,
  type RequestRecommendationResult,
  type TodayRecommendationResult,
  type WaitRecommendationResult,
} from './recommendation/recommendation-runtime';
import type { UpdateRecommendationStateResult } from './persistence/recommendation-repository';
import type { SourceRegistry } from './sources/source-registry';

export interface InterestFacts {
  readonly interests: readonly Interest[];
  readonly evidence: readonly InterestEvidence[];
}

export interface RecommendationReferenceContent {
  readonly type: 'recommendation_reference';
  readonly recommendationId: string;
  readonly sourceName: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly author?: string;
  readonly publishedAt?: string;
  readonly description?: string;
  readonly coverUrl?: string;
  readonly recommendationReason: string;
}

export interface Discovery {
  /** Confirms first Candidate Supply use without waiting for the background execution. */
  confirmCandidateSupply(): Promise<{ readonly status: 'confirmed' | 'already_confirmed' }>;
  changeInterest(request: ChangeInterestRequest): Promise<Interest>;
  /** Updates a Session's participation setting and retracts its Evidence when excluded. */
  setInterestSessionSetting(request: SetInterestSessionSettingRequest): Promise<InterestSessionSetting>;
  observeConversationTurn(request: ObserveConversationTurnRequest): ObserveConversationTurnResult;
  getInterestFacts(request: {
    readonly interestIds: readonly string[];
    readonly evidenceIds: readonly string[];
  }): InterestFacts;
  retractSessionEvidence(sessionId: string): Promise<void>;
  startBackground(options?: { readonly automaticTriggers?: boolean }): Promise<void>;
  requestRecommendation(request: { readonly trigger: 'scheduled' | 'startup_catchup' | 'manual' }): Promise<RequestRecommendationResult>;
  waitRecommendation(request: { readonly requestId: string; readonly timeoutMs: number }): Promise<WaitRecommendationResult>;
  getTodayRecommendation(): TodayRecommendationResult;
  getRecommendationCollection(localDate: string, includeHidden?: boolean): RecommendationCollection | undefined;
  getRecommendationById(recommendationId: string): Recommendation | undefined;
  getRecommendationReference(recommendationId: string): RecommendationReferenceContent | undefined;
  requestCandidateSupply(trigger?: CandidateSupplyTrigger): Promise<CandidateSupplyResult> | undefined;
  getCandidatePool(): CandidatePoolSnapshot | undefined;
  /** Supplies Context with this process's current work snapshot, never durable execution history. */
  getActivePreferenceLearningFacts(batchId: string): PreferenceLearningFacts | undefined;
  getPreferenceLearningCompletion(recommendationId: string): PreferenceLearningCompletion | undefined;
  getDiscoveryHome(request: GetDiscoveryHomeRequest): Promise<DiscoveryHomeView>;
  searchRecommendations(request: SearchRecommendationsRequest): Promise<SearchRecommendationsResult>;
  updateRecommendationState(request: UpdateRecommendationStateRequest): Promise<UpdateRecommendationStateResult>;
  getDiscoveryConfiguration(): Promise<DiscoveryConfigurationView>;
  updateDiscoveryConfiguration(request: UpdateDiscoveryConfigurationRequest): Promise<DiscoveryConfigurationView>;
  connectDiscoverySource(request: ConnectDiscoverySourceRequest): Promise<DiscoverySourceView>;
  refreshDiscoverySource(request: RefreshDiscoverySourceRequest): Promise<DiscoverySourceView>;
  refreshDiscoverySources(): Promise<DiscoveryConfigurationView>;
  shutdown(): Promise<void>;
}

export interface CreateDiscoveryOptions {
  readonly interests?: CreateInterestRuntimeOptions;
  readonly recommendation?: CreateRecommendationRuntimeOptions;
  readonly candidateSupply?: CreateCandidateSupplyRuntimeOptions;
  readonly preferenceLearning?: CreatePreferenceLearningRuntimeOptions;
  readonly configuration?: { readonly sourceRegistry: SourceRegistry; readonly settings: DiscoveryConfigurationStore };
  readonly onBackgroundError?: (error: unknown, context: {
    readonly operation: 'source_refresh' | 'candidate_supply_start'
      | 'preference_learning_start' | 'recommendation_start';
  }) => void;
}

/** Composes Megumi's Discovery business operations from optional capabilities. */
export function createDiscovery(options: CreateDiscoveryOptions): Discovery {
  const preferenceLearning = options.preferenceLearning
    ? createPreferenceLearningRuntime(options.preferenceLearning)
    : undefined;
  const recommendation = options.recommendation
    ? createRecommendationRuntime(options.recommendation)
    : undefined;
  const candidateSupply = options.candidateSupply
    ? createCandidateSupplyRuntime(options.candidateSupply)
    : undefined;
  const interests = options.interests
    ? createInterestRuntime({
        ...options.interests,
        onInterestsChanged: (interestIds) => {
          options.interests?.onInterestsChanged?.(interestIds);
          requestCandidateSupply(candidateSupply, 'interest_changed', options);
        },
      })
    : createDisabledInterestRuntime();
  const configuration = options.configuration
    ? createDiscoveryConfiguration(options.configuration)
    : undefined;

  const recommendationRepository = options.recommendation?.repository;
  return {
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
        await configuration.refreshSources(view.sources.filter(({ enabled }) => enabled).map(({ sourceId }) => sourceId));
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
      if (failures.length > 0) throw new AggregateError(failures, 'Discovery background startup failed.');
    },
    requestRecommendation: (request) => recommendation
      ? recommendation.request(request)
      : Promise.resolve({
          status: 'failed',
          localDate: new Date().toISOString().slice(0, 10),
          failure: { code: 'settings_invalid', message: 'Recommendation is not configured.', retryable: false },
        }),
    waitRecommendation: (request) => recommendation
      ? recommendation.wait(request)
      : Promise.resolve({
          status: 'failed',
          localDate: new Date().toISOString().slice(0, 10),
          failure: { code: 'settings_invalid', message: 'Recommendation is not configured.', retryable: false },
        }),
    getTodayRecommendation: () => recommendation
      ? recommendation.getToday()
      : { status: 'not_generated', localDate: new Date().toISOString().slice(0, 10) },
    getRecommendationCollection: (localDate, includeHidden = false) => (
      recommendationRepository?.getCollection(localDate, includeHidden)
    ),
    getRecommendationById: (recommendationId) => (
      recommendationRepository?.findRecommendationById(recommendationId)
    ),
    getRecommendationReference(recommendationId) {
      const item = recommendationRepository?.findRecommendationById(recommendationId);
      return item ? recommendationReference(item) : undefined;
    },
    requestCandidateSupply: (trigger = 'supply_conditions_changed') => candidateSupply?.requestCheck(trigger),
    getCandidatePool: () => {
      if (!options.candidateSupply) return undefined;
      const settings = options.candidateSupply.settings.read();
      return options.candidateSupply.repository.getCandidatePoolSnapshot(candidatePoolSettings({
        minimumCount: settings.candidatePoolMinimumCount,
        maximumCount: settings.candidatePoolMaximumCount,
        candidateValidityDays: settings.candidateValidityDays,
        candidateContentExcerptMaxCharacters: settings.candidateContentExcerptMaxCharacters,
      }));
    },
    getActivePreferenceLearningFacts: (id) => preferenceLearning?.getActivePreferenceLearningFacts(id),
    getPreferenceLearningCompletion: (id) => options.preferenceLearning?.repository.getPreferenceLearningCompletion(id),
    async getDiscoveryHome(rawRequest) {
      if (!recommendationRepository) throw new Error('Recommendation is not configured.');
      const request = GetDiscoveryHomeRequestSchema.parse(rawRequest);
      const limit = request.limit ?? 20;
      const offset = decodeCursor(request.cursor);
      const page = recommendationRepository.listRecommendations({
        view: request.mode === 'timeline' ? 'history' : request.mode,
        includeHidden: false,
        offset,
        limit,
      });
      const days = new Map<string, RecommendationView[]>();
      for (const item of page.items) {
        const values = days.get(item.localDate) ?? [];
        values.push(recommendationView(item));
        days.set(item.localDate, values);
      }
      return DiscoveryHomeViewSchema.parse({
        candidateSupplyConfirmed: options.candidateSupply?.settings.read().candidateSupplyConfirmed ?? false,
        candidateSupplyStatus: candidateSupply?.getStatus() ?? { status: 'idle' },
        mode: request.mode,
        today: todayView(recommendation?.getToday()),
        days: [...days].map(([localDate, recommendations]) => ({ localDate, recommendations })),
        // Project the home response explicitly; durable revision and lifecycle fields stay on the entity.
        interests: options.interests?.repository.listNonDeletedInterests()
          .filter(({ status }) => status !== 'deleted')
          .map((interest) => ({
            interestId: interest.id,
            description: interest.description,
            status: interest.status,
            createdFrom: interest.createdFrom,
            ...(interest.userManagedAt ? { userManagedAt: interest.userManagedAt } : {}),
            createdAt: interest.createdAt,
            updatedAt: interest.updatedAt,
          })) ?? [],
        favoriteCount: recommendationRepository.countRecommendations('favorites'),
        watchLaterCount: recommendationRepository.countRecommendations('watch_later'),
        ...(recommendation?.getNextScheduledAt() ? { nextScheduledAt: recommendation.getNextScheduledAt() } : {}),
        ...(page.hasMore ? { nextCursor: encodeCursor(offset + limit) } : {}),
      });
    },
    async searchRecommendations(rawRequest) {
      if (!recommendationRepository) throw new Error('Recommendation is not configured.');
      const request = SearchRecommendationsRequestSchema.parse(rawRequest);
      const limit = request.limit ?? 20;
      const offset = decodeCursor(request.cursor);
      const page = recommendationRepository.searchRecommendations({
        query: request.query, includeHidden: false, offset, limit,
      });
      return SearchRecommendationsResultSchema.parse({
        query: request.query,
        recommendations: page.items.map(recommendationView),
        ...(page.hasMore ? { nextCursor: encodeCursor(offset + limit) } : {}),
      });
    },
    async updateRecommendationState(request) {
      if (!recommendationRepository) return { status: 'not_found' };
      const result = recommendationRepository.updateState(request);
      if (request.action === 'set_reaction' && result.status === 'updated') {
        preferenceLearning?.notifyReactionChanged();
      }
      return result;
    },
    getDiscoveryConfiguration: () => configuration
      ? configuration.get()
      : Promise.reject(new Error('Discovery configuration is not configured.')),
    async updateDiscoveryConfiguration(request) {
      if (!configuration) throw new Error('Discovery configuration is not configured.');
      const view = await configuration.update(request);
      requestCandidateSupply(candidateSupply, 'supply_conditions_changed', options);
      return view;
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

function recommendationReference(item: Recommendation): RecommendationReferenceContent {
  return {
    type: 'recommendation_reference',
    recommendationId: item.id,
    sourceName: item.content.sourceName,
    canonicalUrl: item.content.canonicalUrl,
    title: item.content.title,
    ...(item.content.author ? { author: item.content.author } : {}),
    ...(item.content.contentPublishedAt ? { publishedAt: item.content.contentPublishedAt } : {}),
    ...(item.content.description ? { description: item.content.description } : {}),
    ...(item.content.coverUrl ? { coverUrl: item.content.coverUrl } : {}),
    recommendationReason: item.recommendationReason,
  };
}

function recommendationView(item: Recommendation): RecommendationView {
  return {
    recommendationId: item.id,
    localDate: item.localDate,
    position: item.position,
    sourceId: item.content.sourceId,
    sourceName: item.content.sourceName,
    canonicalUrl: item.content.canonicalUrl,
    contentType: item.content.contentType,
    ...(item.content.sourceContentId ? { sourceContentId: item.content.sourceContentId } : {}),
    title: item.content.title,
    ...(item.content.author ? { author: item.content.author } : {}),
    ...(item.content.contentPublishedAt ? { contentPublishedAt: item.content.contentPublishedAt } : {}),
    ...(item.content.description ? { description: item.content.description } : {}),
    contentSummary: item.content.contentSummary,
    ...(item.content.coverUrl ? { coverUrl: item.content.coverUrl } : {}),
    recommendationReason: item.recommendationReason,
    ...(item.state.reaction ? { reaction: item.state.reaction } : {}),
    hidden: item.state.hiddenAt !== undefined,
    favorite: item.state.favoriteAt !== undefined,
    watchLater: item.state.watchLaterAt !== undefined,
    ...(item.state.firstOpenedAt ? { firstOpenedAt: item.state.firstOpenedAt } : {}),
    ...(item.state.lastOpenedAt ? { lastOpenedAt: item.state.lastOpenedAt } : {}),
    publishedAt: item.publishedAt,
  };
}

function todayView(value: TodayRecommendationResult | undefined) {
  if (!value) return { localDate: new Date().toISOString().slice(0, 10), status: 'not_generated', resultCount: 0 };
  if (value.status === 'published') return {
    localDate: value.collection.localDate,
    status: 'published',
    resultCount: value.collection.items.length,
    publishedAt: value.collection.publishedAt,
  };
  return {
    localDate: value.localDate,
    status: value.status,
    resultCount: 0,
    ...('requestId' in value ? { requestId: value.requestId } : {}),
    ...('executionId' in value ? { executionId: value.executionId } : {}),
    ...('failure' in value ? { failure: value.failure } : {}),
  };
}

function encodeCursor(offset: number): string {
  return `offset:${offset}`;
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const match = /^offset:(\d+)$/u.exec(cursor);
  if (!match) throw new Error('Recommendation cursor is invalid.');
  return Number(match[1]);
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
  runtime: ReturnType<typeof createCandidateSupplyRuntime> | undefined,
  trigger: CandidateSupplyTrigger,
  options: CreateDiscoveryOptions,
): void {
  if (!runtime) return;
  void runtime.requestCheck(trigger).catch((error) => {
    try {
      options.onBackgroundError?.(error, { operation: 'candidate_supply_start' });
    } catch {
      // A diagnostic observer cannot change Candidate Supply behavior.
    }
  });
}
