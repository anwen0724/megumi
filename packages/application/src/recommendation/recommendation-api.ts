/*
 * Composes Candidate Supply with user interests, Settings, AI and the Zhihu
 * source, and projects the result onto the Product Host contract.
 *
 * Candidate preparation and maintenance stay a main-process capability: they
 * are reachable through `Recommendation.supply`, not through the Host.
 */
import type { Api, Model } from '@megumi/ai';
import type { Observability } from '../observability/index';
import type { SettingsSnapshot } from '../settings/settings-contracts';
import type { Settings } from '../settings/settings-store';
import type { DatabaseConnection } from '../storage/index';
import type { TextModelClient } from './call-text-model';
import { createCandidateStorage } from './candidates/candidate-storage';
import { createContentStorage } from './content/content-storage';
import { createSearchStorage } from './discovery/search-storage';
import type { InterestManagement } from './interests/interest-contracts';
import { createInterestManagement } from './interests/manage-interests';
import { createInterestStorage } from './interests/interest-storage';
import type {
  DiscoveryHost,
  DiscoveryInterestChangePayload,
  DiscoveryInterestChangeResult,
  DiscoveryInterestListResult,
  SupplyConfigurationView,
  SupplyConfirmResult,
} from './recommendation-contracts';
import { createSourceAccess } from './sources/source-access';
import { SOURCE_CATALOG } from './sources/source-access-contracts';
import type { EmbeddedBrowser } from './sources/browser-access';
import type { WebFetch } from '@megumi/agent';
import { createCandidateSupply } from './supply/create-supply';
import {
  readSupplyConfig,
  readSupplyModel,
  type SupplyExecutionConfig,
  type SupplyModelReference,
} from './supply/read-supply-config';
import { createMaintenanceScheduler } from './supply/schedule-maintenance';
import type { CandidateSupply, SupplyIssue, UnavailableCode } from './supply/supply-contracts';

/** The first-version source catalog. Adding a source is a product decision, not a setting. */
const SUPPLY_SOURCES = SOURCE_CATALOG;

/**
 * Enabled values that have no connector. They never reach planning, and the
 * round reports them so a configuration mistake is visible instead of silent.
 */
export function sourceConfigurationIssues(
  enabledSources: readonly string[],
): readonly SupplyIssue[] {
  return enabledSources
    .filter((id) => !SUPPLY_SOURCES.some((source) => source.sourceId === id))
    .map((id) => ({
      stage: 'configuration' as const,
      code: 'SOURCE_NOT_CONFIGURED',
      subjectId: id,
      message: `Source ${id} is enabled but has no connector and is not planned.`,
    }));
}

export interface RecommendationOptions {
  readonly database: DatabaseConnection;
  readonly settings: Settings;
  readonly observability: Observability;
  /** Sends one validated text-model request; `Models` satisfies this structurally. */
  readonly client: TextModelClient;
  /** Resolves the selected supply model; `undefined` means it cannot be used now. */
  readonly resolveModel: (reference: SupplyModelReference) => Promise<Model<Api> | undefined>;
  /** Reads the selected source credential at request time; never cached here. */
  readonly accessSecret: (sourceId: 'tavily' | 'zhihu') => string | undefined;
  readonly browser?: EmbeddedBrowser;
  readonly sourceFetch?: typeof globalThis.fetch;
  readonly sourceWebFetch?: WebFetch;
  readonly newId: (prefix: string) => string;
  readonly now?: () => number;
  readonly timers?: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  readonly onBackgroundError?: (error: unknown, operation: string) => void;
}

/** The composed Candidate Supply owner, its interest surface, and the Host projection. */
export interface Recommendation {
  readonly sources: ReturnType<typeof createSourceAccess>;
  readonly supply: CandidateSupply;
  readonly interests: InterestManagement;
  /** The renderer-safe surface the Product Host exposes. */
  readonly host: DiscoveryHost;
  /** Starts the startup round and the periodic schedule; a disabled supply stays idle. */
  startBackground(options?: { readonly automaticTriggers?: boolean }): Promise<void>;
  /** Stops the schedule and closes supply; safe to call more than once. */
  shutdown(): Promise<void>;
}

export function createRecommendation(options: RecommendationOptions): Recommendation {
  const now = options.now ?? Date.now;
  const sources = createSourceAccess({
    enabledSources: () => readSettings().enabledSources, accessSecret: options.accessSecret,
    browser: options.browser, fetch: options.sourceFetch, webFetch: options.sourceWebFetch, now,
  });
  const contents = createContentStorage(options.database);
  const candidates = createCandidateStorage(options.database);
  const search = createSearchStorage(options.database);
  const interests = createInterestManagement({
    storage: createInterestStorage(options.database),
    newInterestId: () => options.newId('interest'),
    now,
  });

  const supply = createCandidateSupply({
    local: { database: options.database, contents, candidates, usage, interests, now },
    readConfig: async () => ({ status: 'ok', config: readConfig() }),
    async openRound(config) {
      const settings = readSettings();
      if (!settings.candidateSupplyConfirmed) {
        return unavailable('DISABLED', 'Candidate supply is not enabled.');
      }
      const reference = readSupplyModel(snapshot());
      if (!reference) {
        return unavailable('MODEL_UNAVAILABLE', 'Candidate supply model is not selected.');
      }
      const model = await options.resolveModel(reference);
      if (!model) {
        return unavailable('MODEL_UNAVAILABLE', 'The selected supply model is unavailable.');
      }
      // Only an enabled source with an assembled connector may be planned; a user
      // who disabled every source keeps it disabled: no web-search fallback.
      const connectors = sources.connectors();
      if (connectors.length === 0) {
        return unavailable('SOURCE_UNAVAILABLE', 'No candidate supply source is enabled.');
      }
      return {
        status: 'ok' as const,
        model,
        dependencies: {
          config,
          database: options.database,
          model,
          sources: connectors,
          acquireMaterial: sources.acquireMaterial,
          configIssues: sourceConfigurationIssues(settings.enabledSources),
          client: options.client,
          interests,
          contents,
          candidates,
          search,
          usage,
          retention,
          newId: options.newId,
          now,
          observability: options.observability,
        },
      };
    },
    newId: options.newId,
  });

  const scheduler = createMaintenanceScheduler({
    supply,
    intervalMs: () => readConfig().maintenanceIntervalMinutes * 60_000,
    ...(options.timers
      ? { setTimer: options.timers.setTimeout, clearTimer: options.timers.clearTimeout }
      : {}),
    onError: (error) => options.onBackgroundError?.(error, 'maintenance'),
  });
  let shutdown: Promise<void> | undefined;
  const owner = {
    sources,
    supply,
    interests,

    async startBackground(startOptions: { readonly automaticTriggers?: boolean } = {}) {
      if (startOptions.automaticTriggers === false) return;
      // The enable state decides whether any external work may start at all.
      if (!readSettings().candidateSupplyConfirmed) return;
      scheduler.start();
    },

    shutdown() {
      shutdown ??= (async () => { await scheduler.stop(); await sources.shutdown(); })();
      return shutdown;
    },
  };
  return {
    ...owner,
    host: createDiscoveryOperations({
      recommendation: owner,
      settings: options.settings,
      accessSecret: options.accessSecret,
    }),
  };

  function snapshot(): SettingsSnapshot {
    const result = options.settings.readSettings();
    if (result.status === 'rejected') throw new Error(result.error.message);
    return result.settings;
  }

  function readSettings() {
    return snapshot().config.discovery;
  }

  function readConfig(): SupplyExecutionConfig {
    return readSupplyConfig(snapshot());
  }
}

/**
 * No module records recommendation usage yet: recommendation generation is
 * implemented later against this Spec. The empty snapshot is explicit, and the
 * revision is stable so an unchanged state never looks like a new usage record.
 */
const usage = {
  async readUsageSnapshot() {
    return { revision: 'no_usage_record', excludedContentIds: [] as string[] };
  },
};

/**
 * No module keeps content references yet. Recommendation history and favourites
 * arrive with recommendation generation; until then the honest answer is that
 * nothing outside supply retains a content id.
 */
const retention = {
  async findRetainedContentIds() {
    return [] as string[];
  },
};

function unavailable(code: UnavailableCode, message: string) {
  return { status: 'unavailable' as const, code, message };
}

/** Projects the composed owner onto the renderer-safe Host contract. */
export function createDiscoveryOperations(input: {
  readonly recommendation: Pick<Recommendation, 'interests' | 'startBackground' | 'sources'>;
  readonly settings: Settings;
  readonly accessSecret: (sourceId: 'tavily' | 'zhihu') => string | undefined;
}): DiscoveryHost {
  const read = () => {
    const result = input.settings.readSettings();
    if (result.status === 'rejected') throw new Error(result.error.message);
    return result.settings;
  };
  const list = async () => (await input.recommendation.interests.listInterests()).interests;
  const view = (): SupplyConfigurationView => {
    const enabled = new Set(read().config.discovery.enabledSources);
    return {
      candidateSupplyConfirmed: read().config.discovery.candidateSupplyConfirmed,
      sources: input.recommendation.sources.readStatuses().map((source) => ({
        ...source,
        sourceId: source.sourceId,
        name: SUPPLY_SOURCES.find((entry) => entry.sourceId === source.sourceId)?.name ?? source.sourceId,
        enabled: enabled.has(source.sourceId),
        credentialConfigured: source.sourceId === 'tavily' || source.sourceId === 'zhihu' ? input.accessSecret(source.sourceId) !== undefined : false,
      })),
    };
  };

  return {
    openSourceLogin: (request) => input.recommendation.sources.openSourceLogin(request.sourceId),
    checkSourceAccess: (request) => input.recommendation.sources.checkSourceAccess(request.sourceId),
    async listInterests(): Promise<DiscoveryInterestListResult> {
      return { interests: [...(await list())] };
    },

    async changeInterest(
      request: DiscoveryInterestChangePayload,
    ): Promise<DiscoveryInterestChangeResult> {
      const management = input.recommendation.interests;
      if (request.action === 'create') {
        const result = await management.createInterest({ text: request.description });
        return result.status === 'created'
          ? { status: 'changed', interests: [...(await list())] }
          : { status: 'invalid_request', message: result.message };
      }
      if (request.action === 'delete') {
        const result = await management.deleteInterest({ interestId: request.interestId, expectedRevision: request.expectedRevision });
        if (result.status === 'deleted' || result.status === 'already_deleted') return { status: 'changed', interests: [...(await list())] };
        return result.status === 'revision_conflict' ? { status: 'revision_conflict' } : { status: 'invalid_request', message: result.message };
      }
      const result = await management.updateInterest(
        request.action === 'update'
          ? { interestId: request.interestId, expectedRevision: request.expectedRevision, text: request.description }
          : { interestId: request.interestId, expectedRevision: request.expectedRevision, enabled: request.action === 'resume' },
      );
      if (result.status === 'updated' || result.status === 'unchanged') return { status: 'changed', interests: [...(await list())] };
      return result.status === 'revision_conflict' ? { status: 'revision_conflict' } : result.status === 'not_found'
        ? { status: 'not_found' }
        : { status: 'invalid_request', message: result.message };
    },

    async getConfiguration(): Promise<SupplyConfigurationView> {
      return view();
    },

    async updateConfiguration(request): Promise<SupplyConfigurationView> {
      for (const sourceId of request.enabledSources ?? []) {
        if (!SUPPLY_SOURCES.some((source) => source.sourceId === sourceId)) {
          throw new Error(`Unknown candidate supply source: ${sourceId}`);
        }
      }
      if (request.enabledSources) {
        const result = input.settings.updateSettings({
          patch: { discovery: { enabledSources: request.enabledSources } },
          expectedRevision: read().revision,
        });
        if (result.status === 'rejected') throw new Error(result.error.message);
      }
      return view();
    },

    async confirmCandidateSupply(): Promise<SupplyConfirmResult> {
      if (read().config.discovery.candidateSupplyConfirmed) {
        return { status: 'already_confirmed' };
      }
      const result = input.settings.updateSettings({
        patch: { discovery: { candidateSupplyConfirmed: true } },
        expectedRevision: read().revision,
      });
      if (result.status === 'rejected') throw new Error(result.error.message);
      // The user just enabled supply, so the same entry point starts its background work.
      await input.recommendation.startBackground({ automaticTriggers: true });
      return { status: 'confirmed' };
    },
  };
}
