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
import { createZhihuSource } from './sources/zhihu-source';
import { createCandidateSupply } from './supply/create-supply';
import {
  readSupplyConfig,
  readSupplyModel,
  type SupplyExecutionConfig,
  type SupplyModelReference,
} from './supply/read-supply-config';
import { createMaintenanceScheduler } from './supply/schedule-maintenance';
import type { CandidateSupply, UnavailableCode } from './supply/supply-contracts';

/** The first-version source catalog. Adding a source is a product decision, not a setting. */
const SUPPLY_SOURCES = [{ sourceId: 'zhihu', name: 'Zhihu' }] as const;

const ZHIHU_SOURCE_ID = 'zhihu';

export interface RecommendationOptions {
  readonly database: DatabaseConnection;
  readonly settings: Settings;
  readonly observability: Observability;
  /** Sends one validated text-model request; `Models` satisfies this structurally. */
  readonly client: TextModelClient;
  /** Resolves the selected supply model; `undefined` means it cannot be used now. */
  readonly resolveModel: (reference: SupplyModelReference) => Promise<Model<Api> | undefined>;
  /** Reads the stored Zhihu access secret at request time; never cached here. */
  readonly accessSecret: () => string | undefined;
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
      // A user who disabled every source keeps it disabled: no web-search fallback.
      if (!settings.enabledSources.includes(ZHIHU_SOURCE_ID)) {
        return unavailable('SOURCE_UNAVAILABLE', 'No candidate supply source is enabled.');
      }
      return {
        status: 'ok' as const,
        model,
        dependencies: {
          config,
          database: options.database,
          model,
          source: createZhihuSource({ accessSecret: options.accessSecret }),
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
    supply,
    interests,

    async startBackground(startOptions: { readonly automaticTriggers?: boolean } = {}) {
      if (startOptions.automaticTriggers === false) return;
      // The enable state decides whether any external work may start at all.
      if (!readSettings().candidateSupplyConfirmed) return;
      scheduler.start();
    },

    shutdown() {
      shutdown ??= scheduler.stop();
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
  readonly recommendation: Pick<Recommendation, 'interests' | 'startBackground'>;
  readonly settings: Settings;
  readonly accessSecret: () => string | undefined;
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
      sources: SUPPLY_SOURCES.map((source) => ({
        sourceId: source.sourceId,
        name: source.name,
        enabled: enabled.has(source.sourceId),
        credentialConfigured: input.accessSecret() !== undefined,
      })),
    };
  };

  return {
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
        const result = await management.deleteInterest({ id: request.interestId });
        if (result.status === 'deleted') return { status: 'changed', interests: [...(await list())] };
        return result.status === 'not_found'
          ? { status: 'not_found' }
          : { status: 'invalid_request', message: result.message };
      }
      const result = await management.updateInterest(
        request.action === 'update'
          ? { id: request.interestId, text: request.description }
          : { id: request.interestId, enabled: request.action === 'resume' },
      );
      if (result.status === 'updated') return { status: 'changed', interests: [...(await list())] };
      return result.status === 'not_found'
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
