/*
 * Composes interest, content, candidates, discovery and result consumers in the main process.
 */
import type { Api, Model } from '@megumi/ai';
import type { WebFetch } from '@megumi/agent';
import type { Observability } from '../observability/index';
import type { Settings } from '../settings/settings-store';
import type { DatabaseConnection } from '../storage/index';
import type { TextModelClient } from './call-text-model';
import { createMaterialStorage } from './content/material-storage';
import { createCandidateQualificationStorage } from './candidates/candidate-qualification-storage';
import { createDiscoveryStorage } from './discovery/discovery-storage';
import { createCandidateSupply } from './discovery/create-candidate-supply';
import { createSourceQueue } from './discovery/source-queue';
import { createInterestManagement } from './interests/manage-interests';
import { createInterestStorage } from './interests/interest-storage';
import { createSourceAccess } from './sources/source-access';
import { SOURCE_CATALOG } from './sources/source-access-contracts';
import type { EmbeddedBrowser } from './sources/browser-access';
import { createMaintenanceScheduler } from './supply/schedule-maintenance';
import type { DiscoveryHost, SupplyConfigurationView } from './recommendation-contracts';
export interface RecommendationOptions {
  readonly database: DatabaseConnection;
  readonly settings: Settings;
  readonly observability: Observability;
  readonly client: TextModelClient;
  readonly resolveModel: (reference: {
    providerId: string;
    modelId: string;
  }) => Promise<Model<Api> | undefined>;
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
export type Recommendation = ReturnType<typeof createRecommendation>;
/** Creates owners without starting requests; application startup controls background work. */
export function createRecommendation(options: RecommendationOptions) {
  const now = options.now ?? Date.now;
  const snapshot = () => {
    const read = options.settings.readSettings(); if (read.status === 'rejected')
      throw new Error(read.error.message); return read.settings;
  };
  const readConfiguration = () => { const settings = snapshot(); return { revision: settings.revision, config: settings.config.discovery }; };
  const sources = createSourceAccess({ enabledSources: () => readConfiguration().config.enabledSources, accessSecret: options.accessSecret, browser: options.browser, fetch: options.sourceFetch, webFetch: options.sourceWebFetch, now });
  const materials = createMaterialStorage(options.database, () => options.newId('material'));
  const candidates = createCandidateQualificationStorage(options.database, () => options.newId('match'));
  const discovery = createDiscoveryStorage(options.database, options.newId);
  discovery.interruptRunning(now());
  materials.recoverInterrupted();
  candidates.recoverInterrupted();
  const interests = createInterestManagement({ storage: createInterestStorage(options.database), newInterestId: () => options.newId('interest'), now });
  const sourceQueue = createSourceQueue(() => readConfiguration().config.limits.maxConcurrentSourceRequests);
  const modelQueue = createSourceQueue(() => readConfiguration().config.limits.maxConcurrentModelRequests);
  const resolveSupplyModel = async () => { const reference = readConfiguration().config.candidateSupplyModel; return reference ? options.resolveModel(reference) : undefined; };
  const supply = createCandidateSupply({ materials, candidates, discovery, interests, sources, client: options.client, sourceQueue, modelQueue, now, newId: options.newId, readConfiguration, resolveModel: resolveSupplyModel });
  const scheduler = createMaintenanceScheduler({ supply, intervalMs: () => readConfiguration().config.candidateSupply.maintenanceIntervalMinutes * 60000, ...(options.timers ? { setTimer: options.timers.setTimeout, clearTimer: options.timers.clearTimeout } : {}), onError: error => options.onBackgroundError?.(error, 'maintenance') });
  let backgroundStarted = false;
  const unsubscribe = options.settings.subscribeConfiguration(() => {
    if (!readConfiguration().config.enabled)
      void supply.cancel().catch(error => options.onBackgroundError?.(error, 'disable'));
    else if (backgroundStarted) {
      scheduler.start();
      void supply.startMaintenance({reason:'startup'}).result.catch(error=>options.onBackgroundError?.(error,'enable'));
    }
  });
  let shutdown: Promise<void> | undefined;
  const startBackground = async (input: {
    automaticTriggers?: boolean;
  } = {}) => {
    backgroundStarted = input.automaticTriggers !== false;
    if (backgroundStarted && readConfiguration().config.enabled)
      scheduler.start();
  };
  const host: DiscoveryHost = {
    openSourceLogin: request => sources.openSourceLogin(request.sourceId),
    checkSourceAccess: request => sources.checkSourceAccess(request.sourceId),
    async listInterests() { return { interests: [...(await interests.listInterests()).interests] }; },
    async changeInterest(request) {
      if (request.action === 'create') {
        const result = await interests.createInterest({ text: request.description });
        return result.status === 'created' ? { status: 'changed', interests: [...(await interests.listInterests()).interests] } : { status: 'invalid_request', message: result.message };
      }
      if (request.action === 'delete') {
        const result = await interests.deleteInterest({ interestId: request.interestId, expectedRevision: request.expectedRevision });
        return result.status === 'deleted' || result.status === 'already_deleted' ? { status: 'changed', interests: [...(await interests.listInterests()).interests] } : result.status === 'revision_conflict' ? { status: 'revision_conflict' } : { status: 'invalid_request', message: result.message };
      }
      const result = await interests.updateInterest(request.action === 'update' ? { interestId: request.interestId, expectedRevision: request.expectedRevision, text: request.description } : { interestId: request.interestId, expectedRevision: request.expectedRevision, enabled: request.action === 'resume' });
      return result.status === 'updated' || result.status === 'unchanged' ? { status: 'changed', interests: [...(await interests.listInterests()).interests] } : result.status === 'revision_conflict' ? { status: 'revision_conflict' } : result.status === 'not_found' ? { status: 'not_found' } : { status: 'invalid_request', message: result.message };
    },
    async getConfiguration() { return configurationView(); },
    async updateConfiguration(request) {
      const result = options.settings.updateSettings({ patch: { discovery: { enabledSources: request.enabledSources } }, expectedRevision: snapshot().revision });
      if (result.status === 'rejected')
        throw new Error(result.error.message);
      return configurationView();
    },
    async confirmCandidateSupply() {
      if (readConfiguration().config.enabled)
        return { status: 'already_confirmed' };
      const result = options.settings.updateSettings({ patch: { discovery: { enabled: true } }, expectedRevision: snapshot().revision });
      if (result.status === 'rejected')
        throw new Error(result.error.message);
      await startBackground();
      return { status: 'confirmed' };
    }
  };
  function configurationView(): SupplyConfigurationView {
    const config = readConfiguration().config;
    return { candidateSupplyConfirmed: config.enabled, sources: sources.readStatuses().map(source => ({ ...source, name: SOURCE_CATALOG.find(s => s.sourceId === source.sourceId)!.name, enabled: config.enabledSources.includes(source.sourceId), credentialConfigured: (source.sourceId === 'tavily' || source.sourceId === 'zhihu') && options.accessSecret(source.sourceId) !== undefined })) };
  }
  return {
    sources, supply, interests, host, startBackground,
    shutdown() { shutdown ??= (async () => { unsubscribe(); await scheduler.stop(); await sources.shutdown(); })(); return shutdown; }
  };
}
