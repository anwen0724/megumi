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
import { InterestUiSchema, RecommendationConfigurationUpdateSchema, type RecommendationHost, type RecommendationConfigurationView } from './recommendation-contracts';
import { createDailyFeedStorage } from './daily-feed-storage';
import { createRecommendationRunStorage } from './recommendation-run-storage';
import { createDailyFeed } from './create-daily-feed';
import {RecommendationRunViewSchema} from './feed-contracts';
import {createCuratedSelectionStorage} from './curated-selection-storage';
import {createCuratedSelection} from './create-curated-selection';
import {interestSetHash} from './interests/interest-set';
import {createFavoriteStorage} from './favorite-storage';
import {createRecommendationRetention} from './recommendation-retention';
import {currentTimezone,localDate,shiftDate} from './daily-calendar';
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
  readonly timezone?: () => string;
  readonly timers?: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  readonly onBackgroundError?: (error: unknown, operation: string) => void;
  readonly openExternal?: (url: string) => Promise<void>;
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
  const interestStorage = createInterestStorage(options.database);
  const interests = createInterestManagement({ storage: interestStorage, newInterestId: () => options.newId('interest'), now });
  const sourceQueue = createSourceQueue(() => readConfiguration().config.limits.maxConcurrentSourceRequests);
  const modelQueue = createSourceQueue(() => readConfiguration().config.limits.maxConcurrentModelRequests);
  const resolveSupplyModel = async () => { const reference = readConfiguration().config.candidateSupplyModel; return reference ? options.resolveModel(reference) : undefined; };
  const supply = createCandidateSupply({ materials, candidates, discovery, interests, sources, client: options.client, sourceQueue, modelQueue, now, newId: options.newId, readConfiguration, resolveModel: resolveSupplyModel,onFinished:()=>{if(backgroundStarted)checkCurated();} });
  type ChangedEvent = import('./feed-contracts').RecommendationChanged;
  const listeners = new Set<(event: ChangedEvent) => void>();
  const changed = (event: ChangedEvent) => {
    for (const listener of listeners) {
      try {
        listener(event);
      }
      catch (error) {
        options.onBackgroundError?.(error, 'recommendation_notification');
      }
    }
  };
  const runs = createRecommendationRunStorage(options.database, options.newId);
  runs.interrupt(now());
  const dailyStorage = createDailyFeedStorage({ database: options.database, materials, interests: () => interestStorage.list(), newId: options.newId, now });
  const daily = createDailyFeed({ materials, candidates, discovery, interests, sources, client: options.client, sourceQueue, modelQueue, now, newId: options.newId, readConfiguration, resolveModel: resolveSupplyModel, storage: dailyStorage, runs, timezone: options.timezone, changed });
  const curatedStorage=createCuratedSelectionStorage({database:options.database,materials,candidates,interests:()=>interestStorage.list(),now,newId:options.newId,runs});
  const favorites=createFavoriteStorage({database:options.database,materials,now});
  const retention=createRecommendationRetention(options.database);
  /** Owners release their history first; Content obtains the remaining read-only references under lock. */
  async function cleanup() {
    const time=now();
    retention.cleanup(shiftDate(localDate(time,(options.timezone??currentTimezone)()),-6),time-30*86400000);
    candidates.cleanup(time);
    options.database.transaction({operation:()=>{
      options.database.prepare({sql:'UPDATE recommendation_state SET id=id WHERE id=1'}).run();
      const protectedIds=new Set([...retention.displayedContentIds(),...candidates.listEligible(time).map(pair=>pair.contentId)]);
      const abandoned=[...materials.abandonPending(time-7*86400000,protectedIds),...candidates.abandonPending(time-7*86400000,protectedIds)];
      discovery.cleanup(time,protectedIds,abandoned,new Set([...materials.activeRunIds(),...candidates.activeRunIds()]));
    }});
    return materials.cleanup(time-30*86400000,()=>{
      const retained=[retention.references(),candidates.references(),discovery.references(time)];
      return {contentIds:retained.flatMap(item=>item.contentIds),materialIds:retained.flatMap(item=>item.materialIds)};
    });
  }
  const resolveRecommendationModel=async()=>{const config=readConfiguration().config;const reference=config.recommendationModel??config.candidateSupplyModel;return reference?options.resolveModel(reference):undefined;};
  const curated=createCuratedSelection({candidates,interests,discovery,client:options.client,modelQueue,now,readConfiguration,newId:options.newId,resolveModel:resolveRecommendationModel,storage:curatedStorage,runs,changed,onError:error=>options.onBackgroundError?.(error,'curated_selection')});
  const scheduler = createMaintenanceScheduler({ supply, intervalMs: () => readConfiguration().config.candidateSupply.maintenanceIntervalMinutes * 60000, ...(options.timers ? { setTimer: options.timers.setTimeout, clearTimer: options.timers.clearTimeout } : {}), onError: error => options.onBackgroundError?.(error, 'maintenance') });
  let backgroundStarted = false;
  let dailyTimer: unknown;
  const setTimer = options.timers?.setTimeout ?? ((callback: () => void, delay: number) => setTimeout(callback, delay));
  const clearTimer = options.timers?.clearTimeout ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const checkDaily = (force = false) => { void daily.check(force).catch(error => options.onBackgroundError?.(error, 'daily_feed')); };
  const checkCurated=()=>{void curated.check().catch(error=>options.onBackgroundError?.(error,'curated_selection'));};
  let lastCleanupDate:string|undefined;
  const checkCleanup=()=>{
    const date=localDate(now(),(options.timezone??currentTimezone)());
    if(lastCleanupDate===date)return;
    void cleanup().then(()=>{lastCleanupDate=date;},error=>options.onBackgroundError?.(error,'recommendation_cleanup'));
  };
  const scheduleDaily = () => { dailyTimer = setTimer(() => { checkDaily();checkCurated();checkCleanup(); scheduleDaily(); }, 60000); };
  const unsubscribe = options.settings.subscribeConfiguration(() => {
    if (!readConfiguration().config.enabled) {
      daily.cancel();
      curated.cancel();
      void supply.cancel().catch(error => options.onBackgroundError?.(error, 'disable'));
    }
    else if (backgroundStarted) {
      scheduler.start();
      void supply.startMaintenance({reason:'startup'}).result.catch(error=>options.onBackgroundError?.(error,'enable'));
      checkDaily(true);
      checkCurated();
    }
  });
  let shutdown: Promise<void> | undefined;
  const startBackground = async (input: {
    automaticTriggers?: boolean;
  } = {}) => {
    backgroundStarted = input.automaticTriggers !== false;
    if (backgroundStarted && readConfiguration().config.enabled)
      scheduler.start();
    if (backgroundStarted && dailyTimer === undefined) {
      checkDaily();
      checkCurated();checkCleanup();
      scheduleDaily();
    }
  };
  const host: RecommendationHost = {
    async openContent(request) {
      const url=materials.savedUrl(request.contentId);
      if(!url)throw Object.assign(new Error('The saved content does not exist.'),{code:'CONTENT_NOT_FOUND'});
      if(!options.openExternal)throw Object.assign(new Error('The desktop URL opener is unavailable.'),{code:'STORAGE_ERROR'});
      await options.openExternal(url);
      return {status:'accepted'};
    },
    async listFavorites(request){return favorites.list(request);},
    async setFavorite(request){const result=favorites.set(request);if(result.changed)changed({kind:'favorite'});return result;},
    async getCuratedSelection(){const current=curatedStorage.current();const enabled=interestStorage.list().filter(item=>item.enabled);const lastRun=runs.latestCurated();return {...(current?{selection:current.selection}:{}),needsUpdate:current?interestSetHash(enabled)!==current.interestHash:enabled.length>0,...(curated.activeRun()?{activeRun:curated.activeRun()}:{}),...(lastRun?{lastRun}:{}),supplyStatus:await supply.getSupplyStatus()};},
    startCuratedSelection:request=>curated.start(request),
    onChanged(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async listDailyFeed(request) { return daily.list(request); },
    startDailyFeed: request => daily.start(request),
    async getRun(request) {
      const result=runs.view(request.runId);if(result)return result;
      const run=discovery.readRun(request.runId);if(!run)return undefined;
      return RecommendationRunViewSchema.parse({id:run.id,kind:run.purpose,status:run.status,startedAt:new Date(run.startedAt).toISOString(),finishedAt:run.finishedAt===null?null:new Date(run.finishedAt).toISOString(),issues:run.issues});
    },
    async cancelRun(request) {
      const run=runs.read(request.runId);
      if(run)return {status:run.kind==='curated'?curated.cancel(request.runId):daily.cancel(request.runId)};
      return {status:discovery.readRun(request.runId)?supply.requestCancel(request.runId):'not_found'};
    },
    openSourceLogin: request => sources.openSourceLogin(request.sourceId),
    async checkSourceAccess(request) {const result=await sources.checkSourceAccess(request.sourceId);changed({kind:'source_access'});return result;},
    async listInterests() { return { interests: [...(await interests.listInterests()).interests] }; },
    async createInterest(request) {
      const result=await interests.createInterest(request);
      if(result.status==='invalid_request')throw Object.assign(new Error(result.message),{code:'INVALID_REQUEST'});
      interestChanged(result.interest.id);
      const {id,text,enabled,revision}=result.interest;
      return {status:'created',interest:InterestUiSchema.parse({id,text,enabled,revision})};
    },
    async updateInterest(request) {
      const result=await interests.updateInterest(request);
      if(result.status==='invalid_request')throw Object.assign(new Error(result.message),{code:'INVALID_REQUEST'});
      if(result.status==='revision_conflict')throw Object.assign(new Error('Interest revision changed.'),{code:'REVISION_CONFLICT'});
      if(result.status==='not_found')throw Object.assign(new Error('Interest does not exist.'),{code:'INTEREST_NOT_FOUND'});
      if(result.status==='updated')interestChanged(result.interest.id);
      const {id,text,enabled,revision}=result.interest;
      return {status:result.status,interest:InterestUiSchema.parse({id,text,enabled,revision})};
    },
    async deleteInterest(request) {
      const result=await interests.deleteInterest(request);
      if(result.status==='invalid_request')throw Object.assign(new Error(result.message),{code:'INVALID_REQUEST'});
      if(result.status==='revision_conflict')throw Object.assign(new Error('Interest revision changed.'),{code:'REVISION_CONFLICT'});
      if(result.status==='deleted')interestChanged(request.interestId);
      return result;
    },
    async getConfiguration() { return configurationView(); },
    async updateConfiguration(request) {
      const parsed=RecommendationConfigurationUpdateSchema.safeParse(request);
      if(!parsed.success)throw Object.assign(new Error(parsed.error.message),{code:'INVALID_REQUEST'});
      const result = options.settings.updateSettings({ patch: { discovery: parsed.data.changes }, expectedRevision: parsed.data.expectedRevision });
      if (result.status === 'rejected')throw Object.assign(new Error(result.error.message),{code:result.error.code==='SETTINGS_CONFLICT'?'REVISION_CONFLICT':'INVALID_REQUEST'});
      return configurationView();
    }
  };
  /** Commits are authoritative; background checks accept work without awaiting external calls. */
  function interestChanged(interestId:string) {
    changed({kind:'interest',interestId});
    if(backgroundStarted){checkDaily(true);void curated.check().catch(error=>options.onBackgroundError?.(error,'curated_selection'));}
  }
  function configurationView(): RecommendationConfigurationView {
    const {config,revision} = readConfiguration();
    return { revision,config, sources: sources.readStatuses().map(source => ({ ...source, name: SOURCE_CATALOG.find(s => s.sourceId === source.sourceId)!.name, enabled: config.enabledSources.includes(source.sourceId), credentialConfigured: (source.sourceId === 'tavily' || source.sourceId === 'zhihu') && options.accessSecret(source.sourceId) !== undefined })) };
  }
  return {
    sources, supply, interests, daily, curated, host, startBackground,cleanup,
    /** Accepts today's due work on OS resume; it does not wait for external acquisition. */
    async resumeBackground() {
      if (backgroundStarted && !shutdown){await daily.check();await curated.check();checkCleanup();}
    },
    onChanged(listener: (event: ChangedEvent) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    shutdown() {
      shutdown ??= (async () => {
        unsubscribe();
        if (dailyTimer !== undefined) clearTimer(dailyTimer);
        await daily.close();
        await curated.close();
        await scheduler.stop();
        await sources.shutdown();
        listeners.clear();
      })();
      return shutdown;
    }
  };
}
