/*
 * Runs durable discovery and supplies the single pool without owning content or qualification tables.
 */
import { z } from 'zod';
import type { Api, Model } from '@megumi/ai';
import type { RecommendationConfiguration } from '../../settings/definitions/recommendation';
import type { TextModelClient } from '../call-text-model';
import { callTextModel } from '../call-text-model';
import type { InterestManagement, InterestSnapshotEntry } from '../interests/interest-contracts';
import type { CandidateQualificationStorage } from '../candidates/candidate-qualification-storage';
import { createMaterialStorage } from '../content/material-storage';
import type { ContentMaterial } from '../content/material-contracts';
import type { DiscoveryAttempt } from '../content/material-contracts';
import { normalizeRawItem } from '../content/normalize-content';
import type { createSourceAccess } from '../sources/source-access';
import type { RawItem } from '../sources/source-connector';
import { identifyContentUrl } from '../sources/source-material';
import { sourceFailure } from '../sources/source-http';
import type { DiscoveryStorage, DiscoveryQuery, DiscoveryIssue, SavedDiscovery, SearchYield } from './discovery-storage';
import { createDiscoveryBudget } from './discovery-budget';
import type { SourceQueue } from './source-queue';
import { processMaterial } from './process-material';
export interface CandidateMaintenanceOptions {
  runId: string;
  purpose: 'candidate_supply' | 'daily_feed';
  config: RecommendationConfiguration;
  configRevision: string;
  model: Model<Api>;
  client: TextModelClient;
  sources: ReturnType<typeof createSourceAccess>;
  materials: ReturnType<typeof createMaterialStorage>;
  candidates: CandidateQualificationStorage;
  discovery: DiscoveryStorage;
  interests: InterestManagement;
  sourceQueue: SourceQueue;
  modelQueue: SourceQueue;
  now(): number;
  signal: AbortSignal;
  window?: {
    start: number;
    end: number;
  };
  interestIds?: readonly string[];
  onMaterial?: (material: ContentMaterial, interest: InterestSnapshotEntry) => Promise<void>;
}
/** Restores saved work, plans bounded queries, and records yields only after downstream work settles. */
export async function maintainCandidates(input: CandidateMaintenanceOptions) {
  const { config, discovery, now } = input;
  const budget = createDiscoveryBudget(config.limits, now(), now);
  const deadline = AbortSignal.timeout(config.limits.maxDurationMinutes * 60000);
  const signal = AbortSignal.any([input.signal, deadline]);
  const issues: DiscoveryIssue[] = [];
  const interests = (await input.interests.listInterests()).interests.filter(i => i.enabled && (!input.interestIds || input.interestIds.includes(i.id)));
  discovery.state();
  discovery.startRun({ id: input.runId, purpose: input.purpose, interests, configRevision: input.configRevision, now: now(), budget });
  const priority = input.purpose === 'daily_feed' ? 1 : 0;
  const tasks: Promise<void>[] = [];
  const processing = new Map<string, Promise<void>>();
  const yields: SearchYield[] = [];
  const process = (material: ContentMaterial) => {
    const existing = processing.get(material.id);
    if (existing)
      return existing;
    const task = processMaterial(material, { ...input, budget, signal, priority, issues, currentInterests: async () => (await input.interests.listInterests()).interests });
    processing.set(material.id, task);
    return task;
  };
  let discovered = 0;
  try {
    const restored = input.materials.listCurrentMaterials();
    const state = discovery.state();
    const cursor = input.purpose === 'daily_feed' ? state.dailyCursor : state.candidateCursor;
    const start = interests.findIndex(i => i.id === cursor);
    const rotated = start > 0 ? [...interests.slice(start), ...interests.slice(0, start)] : interests;
    const backlog = new Map(rotated.map(i => [i.id, actionableBacklog(i, restored)]));
    for (const interest of rotated)
      if ((backlog.get(interest.id) ?? 0) >= 2 * config.candidateSupply.interestTargetCount && input.purpose === 'candidate_supply')
        issues.push({ code: 'backlog_limit', message: 'Existing actionable work has reached the interest backlog limit.', subjectId: interest.id });
    const wanted = rotated.filter(i => input.purpose === 'daily_feed' || input.candidates.inventory(now(), i.id, config.candidateSupply.contentLanguages) < config.candidateSupply.interestMinimumCount && (backlog.get(i.id) ?? 0) < 2 * config.candidateSupply.interestTargetCount && (!state.backoff[i.id] || state.backoff[i.id]!.revision !== i.revision || state.backoff[i.id]!.nextAt <= now())).slice(0, Math.max(1, config.limits.maxSearchCalls - 5));
    const available = input.sources.connectors().filter(s => (state.cooldowns[s.id] ?? 0) <= now());
    if (wanted.length && !available.length) issues.push({code:'SOURCE_UNAVAILABLE',message:'No enabled search source is available for the current shortage.'});
    // Reserve planning before restoring model work, so a blocked analysis cannot starve searches.
    const planning = wanted.length && available.length && !signal.aborted ? planQueries(wanted, available.map(s => s.descriptor)) : Promise.resolve([]);
    if (input.purpose === 'candidate_supply') {
      for (const material of restored)
        tasks.push(process(material));
      for (const saved of discovery.pendingResults(60, now()))
        tasks.push(intake(saved));
    }
    const plan = await planning;
    discovery.savePlan(input.runId, plan);
    for (const query of plan) {
      if (signal.aborted || budget.expired())
        break;
      const current = (await input.interests.listInterests()).interests.find(i => i.id === query.interestId && i.revision === query.interestRevision && i.enabled);
      if (!current)
        continue;
      const source = available.find(s => s.id === query.sourceId)!;
      const availableResults = input.purpose === 'daily_feed' ? config.dailyFeed.maxItemsPerInterest : 2 * config.candidateSupply.interestTargetCount - (backlog.get(current.id) ?? 0);
      if (availableResults <= 0)
        continue;
      const queryId = discovery.queryId(query, now());
      const cached = discovery.recent(queryId, source.id, input.purpose, input.window, now() - config.candidateSupply.searchReuseIntervalMinutes * 60000);
      let found: {
        historyId: string;
        items: SavedDiscovery[];
      };
      if (cached)
        found = cached;
      else {
        // Five logical search slots remain available for approved fallback paths.
        if (budget.remaining('searchCalls') <= Math.min(5, config.limits.maxSearchCalls - 1))
          break;
        if (!budget.reserve('searchCalls'))
          break;
        let firstService = true;
        const response = await input.sourceQueue.run(() => source.search({
          query: query.query, limit: Math.min(availableResults, source.descriptor.maxResultsPerSearch), ...(input.window ? { timeRange: { from: input.window.start, to: input.window.end } } : {}), signal: AbortSignal.any([signal, AbortSignal.timeout(config.limits.requestTimeoutSeconds * 1000)]), reserveSearch: () => {
            if (firstService) {
              firstService = false;
              return true;
            } return budget.reserve('searchCalls');
          }, reserveRequest: () => budget.reserve('sourceRequests')
        }), signal, priority);
        if (signal.aborted)
          break;
        found = discovery.saveSearch({ runId: input.runId, queryId, sourceId: source.id, purpose: input.purpose, query: query.query, now: now(), window: input.window, ...(response.status === 'success' ? { items: response.items } : { errorCode: response.failure.code }) });
        if (response.status === 'failed') {
          issues.push({ code: response.failure.code.toUpperCase(), message: response.failure.message, subjectId: source.id });
          yields.push({ historyId: found.historyId, interestId: current.id, interestRevision: current.revision, resultIds: [], status: 'incomplete', admittedContentIds: [], settledAt: now() });
          discovery.saveYield(input.runId, yields);
          if (response.failure.retryAfterMs) {
            state.cooldowns[source.id] = now() + response.failure.retryAfterMs;
            discovery.saveState({ cooldowns: state.cooldowns });
          }
          continue;
        }
      }
      discovered += found.items.length;
      backlog.set(current.id, (backlog.get(current.id) ?? 0) + found.items.filter(saved => !saved.contentId).length);
      if (!cached) {
        yields.push({ historyId: found.historyId, interestId: current.id, interestRevision: current.revision, resultIds: found.items.map(i => i.resultId), status: 'pending', admittedContentIds: [], settledAt: null });
        discovery.saveYield(input.runId, yields);
      }
      for (const saved of found.items)
        tasks.push(intake(saved, current));
      const position = rotated.findIndex(i => i.id === current.id);
      discovery.saveState({ cursor: rotated[(position + 1) % rotated.length]?.id ?? null, purpose: input.purpose });
      discovery.checkpoint(input.runId, budget);
    }
    await Promise.all(tasks);
    await settleYields();
    if (!signal.aborted && ['analysisCalls', 'matchingCalls', 'fetchCalls'].some(kind => budget.remaining(kind as 'analysisCalls' | 'matchingCalls' | 'fetchCalls') === 0)) {
      const pending = input.materials.listCurrentMaterials().some(m => input.materials.analysisWork(m.contentId, m.id, now()) !== 'ready' || interests.some(i => input.candidates.matchingWork(m.contentId, m.id, i.id, i.revision, now()) !== 'ready'));
      if (pending)
        issues.push({ code: 'BUDGET_EXHAUSTED', message: 'Saved work remains pending after this run reached a stage budget.' });
    }
    const status = signal.aborted ? 'cancelled' : issues.length ? 'partial' : 'completed';
    discovery.finishRun(input.runId, status, now(), budget, issues);
    return { status, discoveredItems: discovered, candidates: input.candidates.listCandidates(now(), { contentLanguages: config.candidateSupply.contentLanguages }).length, issues };
  }
  catch (error) {
    await Promise.allSettled(tasks);
    discovery.finishRun(input.runId, signal.aborted ? 'cancelled' : 'failed', now(), budget, [...issues, { code: signal.aborted ? 'CANCELLED' : 'STORAGE_ERROR', message: error instanceof Error ? error.message : 'Discovery failed.' }]);
    if (!signal.aborted)
      throw error;
    return { status: 'cancelled' as const, discoveredItems: discovered, candidates: 0, issues };
  }
  /** A failed planner is a reported gap; user text is never substituted as an unreviewed query. */
  async function planQueries(selected: readonly InterestSnapshotEntry[], sources: readonly unknown[]): Promise<DiscoveryQuery[]> {
    const schema = z.object({ items: z.array(z.object({ interestId: z.string(), sourceId: z.string(), query: z.string().trim().min(1).max(200), direction: z.enum(['direct', 'exploratory']), basis: z.string().trim().min(1) }).strict()) }).strict();
    const system = 'Plan searches from the authoritative interest text. Return {items:[{interestId,sourceId,query,direction:direct/exploratory,basis}]}. Use only supplied sources and interests, at most two queries per interest. Exploratory queries must explain their connection. Do not invent a user profile.';
    let correction: string | undefined;
    const history = selected.map(interest => ({ interestId: interest.id, items: discovery.planningHistory(interest.id, interest.revision, now() - config.candidateSupply.searchHistoryDays * 86400000) }));
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt = JSON.stringify({ stage: 'planning', interests: selected, sources, purpose: input.purpose, window: input.window, history, inventory: selected.map(i => ({ interestId: i.id, eligible: input.candidates.inventory(now(), i.id, config.candidateSupply.contentLanguages), target: config.candidateSupply.interestTargetCount })), correction });
      const reservation = budget.reserveModel('planningCalls', input.model, system, prompt);
      if (typeof reservation === 'string')
        break;
      const response = await input.modelQueue.run(() => callTextModel(input.client, { model: input.model, systemPrompt: system, prompt, schema, maxOutputTokens: reservation.output, signal }), signal, priority);
      if (response.status === 'failed') {
        if (response.code === 'INVALID_RESULT' && attempt === 0) {
          correction = response.message;
          continue;
        }
        issues.push({ code: response.code === 'INVALID_RESULT' ? 'MODEL_OUTPUT_INVALID' : response.code, message: response.message });
        return [];
      }
      budget.settleModel(reservation, response.record.usage);
      const counts = new Map<string, number>();
      const valid = response.result.items.every(q => {
        counts.set(q.interestId, (counts.get(q.interestId) ?? 0) + 1);
        const previous = history.find(h => h.interestId === q.interestId)?.items.filter(item => item.query === q.query && item.sourceId === q.sourceId).slice(0, 2);
        const repeatedZero = previous?.length === 2 && previous.every(item => item.status === 'completed' && item.admitted === 0);
        return !repeatedZero && selected.some(i => i.id === q.interestId) && input.sources.connectors().some(s => s.id === q.sourceId) && (counts.get(q.interestId) ?? 0) <= 2;
      });
      if (valid && selected.every(i => response.result.items.some(q => q.interestId === i.id && q.direction === 'direct'))) {
        const ordered = selected.flatMap(i => response.result.items.filter(q => q.interestId === i.id).slice(0, 1)).concat(selected.flatMap(i => response.result.items.filter(q => q.interestId === i.id).slice(1)));
        return ordered.map(q => ({ ...q, interestRevision: selected.find(i => i.id === q.interestId)!.revision }));
      }
      correction = 'Use only supplied IDs and at most two queries per interest.';
    }
    issues.push({ code: 'MODEL_OUTPUT_INVALID', message: 'Search plan could not be validated.' });
    return [];
  }
  /** Saves source material before independent analysis; daily consumers may commit at this boundary. */
  async function intake(saved: SavedDiscovery, interest?: InterestSnapshotEntry): Promise<void> {
    if (signal.aborted)
      return;
    const identity = identifyContentUrl(saved.item.url);
    if (!identity)
      return;
    let raw: RawItem = saved.item;
    const contentId = input.materials.ensureIdentity({ platform: identity.platform ?? 'web', externalId: identity.externalId, canonicalUrl: identity.url, title: raw.title, author: raw.author, now: now() });
    let current = input.materials.readCurrentMaterial(contentId);
    if ((!raw.text || raw.kind === 'excerpt') && (!current || current.kind === 'excerpt') && budget.remaining('fetchCalls')) {
      let attempt: DiscoveryAttempt | undefined;
      let failure: string | undefined;
      try {
        const response = await input.sourceQueue.run(() => {
          if (!budget.reserve('fetchCalls'))
            return Promise.resolve(sourceFailure('budget_exhausted', 'Material budget is exhausted.'));
          attempt = input.discovery.claimMaterial({ contentId, materialId: current?.id ?? 'none', url: raw.requestUrl ?? raw.url, runId: input.runId, now: now(), deadlineAt: Math.min(budget.deadlineAt, now() + config.limits.requestTimeoutSeconds * 1000) });
          if (!attempt) {
            budget.release('fetchCalls');
            return Promise.resolve(sourceFailure('cancelled', 'Material input is claimed or waiting for retry.'));
          }
          return input.sources.acquireMaterial(raw, { signal: AbortSignal.any([signal, AbortSignal.timeout(config.limits.requestTimeoutSeconds * 1000)]), reserveRequest: () => budget.reserve('sourceRequests') });
        }, signal, priority);
        if (response.status === 'success' && attempt && !signal.aborted) {
          const acquired = { ...raw, ...response.material, publicationEvidence: [...(raw.publicationEvidence ?? []), ...(response.material.publicationEvidence ?? [])] };
          if (input.discovery.completeMaterial(attempt, now(), () => { current = saveRaw(acquired); }))
            raw = acquired;
        }
        else if (response.status === 'failed')
          failure = response.failure.code;
      }
      finally {
        if (attempt)
          input.discovery.releaseMaterial(attempt, now(), failure === 'cancelled' ? undefined : failure);
      }
      if (failure && failure !== 'cancelled')
        issues.push({ code: failure.toUpperCase(), message: 'Detail material could not be acquired.', subjectId: contentId });
    }
    if (signal.aborted)
      return;
    current = saveRaw(raw) ?? current;
    discovery.saveResult(saved.resultId, raw, contentId, now(), current ? undefined : 'MATERIAL_UNAVAILABLE');
    if (!current)
      return;
    for (const yielded of yields.filter(row => row.resultIds.includes(saved.resultId))) {
      const field = current.acquiredAt >= (discovery.readRun(input.runId)?.startedAt ?? now()) ? 'newMaterialContentIds' : 'reusedMaterialContentIds';
      yielded[field] = [...new Set([...(yielded[field] ?? []), current.contentId])];
    }
    discovery.saveYield(input.runId, yields);
    if (interest && input.onMaterial)
      await input.onMaterial(current, interest);
    await process(current);
  }
  function saveRaw(raw: RawItem): ContentMaterial | undefined {
    const normalized = normalizeRawItem(raw, { contentLanguages: config.candidateSupply.contentLanguages });
    if (normalized.status !== 'ok')
      return undefined;
    const identity = identifyContentUrl(raw.url)!;
    return input.materials.saveMaterial({ externalId: identity.externalId, platform: identity.platform ?? 'web', canonicalUrl: normalized.content.canonicalUrl, title: raw.title, author: raw.author, authorId: raw.authorId, language: normalized.content.language, text: normalized.content.text, kind: raw.kind ?? 'excerpt', truncated: raw.truncated ?? false, rangeStart: raw.rangeStart ?? 0, rangeEnd: (raw.rangeStart ?? 0) + [...normalized.content.text].length, method: raw.method ?? raw.source, acquiredAt: now(), publicationEvidence: [...(raw.publicationEvidence ?? [])] }).material;
  }
  /** Counts each material once at its earliest runnable stage, excluding retry and dependency blockers. */
  function actionableBacklog(interest: InterestSnapshotEntry, materials: readonly ContentMaterial[]): number {
    const discoveries = discovery.forInterest(interest.id, interest.revision);
    const assigned = new Set(discoveries.map(saved => saved.contentId).filter(id => id !== undefined));
    const missing = discoveries.filter(saved => discovery.resultActionable(saved.resultId,now()) && (!saved.contentId || !input.materials.readCurrentMaterial(saved.contentId))).length;
    return missing + materials.filter(material => {
      const analysis = input.materials.analysisWork(material.contentId, material.id, now());
      const matching = input.candidates.matchingWork(material.contentId, material.id, interest.id, interest.revision, now());
      return (analysis === 'actionable' || analysis === 'running') && assigned.has(material.contentId) || analysis === 'ready' && (matching === 'actionable' || matching === 'running');
    }).length;
  }
  /** Restored judgments settle the original search yield once, excluding failures and stale interests. */
  async function settleYields(): Promise<void> {
    const currentInterests = (await input.interests.listInterests()).interests.filter(i => i.enabled);
    const state = discovery.state();
    const all = discovery.pendingYields();
    const changed = new Map<string, SearchYield[]>();
    const admitted = new Set(all.filter(y => y.status === 'completed').flatMap(y => y.admittedContentIds.map(id => `${y.interestId}:${y.interestRevision}:${input.candidates.duplicateGroup(id)}`)));
    for (const yielded of all) {
      const peers = changed.get(yielded.runId) ?? all.filter(y => y.runId === yielded.runId).map(({ runId, ...y }) => y);
      changed.set(yielded.runId, peers);
      const row = peers.find(y => y.historyId === yielded.historyId)!;
      if (row.status !== 'pending')
        continue;
      const interest = currentInterests.find(i => i.id === row.interestId && i.revision === row.interestRevision);
      if (!interest) {
        row.status = 'incomplete';
        row.settledAt = now();
        continue;
      }
      const found = discovery.readResults(row.historyId);
      row.failedResultIds = found.filter(saved => {
        if (discovery.resultFailed(saved.resultId))
          return true;
        const material = saved.contentId ? input.materials.readCurrentMaterial(saved.contentId) : undefined;
        return material && (input.materials.analysisWork(material.contentId, material.id, now()) === 'failed' || input.candidates.matchingWork(material.contentId, material.id, interest.id, interest.revision, now()) === 'failed');
      }).map(saved => saved.resultId);
      if (row.failedResultIds.length) {
        row.status = 'incomplete';
        row.settledAt = now();
        continue;
      }
      const unfinished = found.some(saved => { const m = saved.contentId ? input.materials.readCurrentMaterial(saved.contentId) : undefined; return !m || input.materials.analysisWork(m.contentId, m.id, now()) !== 'ready' || input.candidates.matchingWork(m.contentId, m.id, interest.id, interest.revision, now()) !== 'ready'; });
      if (unfinished)
        continue;
      row.status = 'completed';
      row.settledAt = now();
      const eligible = input.candidates.listEligible(now(), { contentLanguages: config.candidateSupply.contentLanguages });
      row.rejectedContentIds = found.flatMap(saved => saved.contentId && !eligible.some(q => q.contentId === saved.contentId && q.interestId === interest.id) ? [saved.contentId] : []);
      row.admittedContentIds = [...new Set(found.flatMap(saved => eligible.some(q => q.contentId === saved.contentId && q.interestId === interest.id) && !admitted.has(`${interest.id}:${interest.revision}:${input.candidates.duplicateGroup(saved.contentId!)}`) ? [saved.contentId!] : []))];
      for (const id of row.admittedContentIds)
        admitted.add(`${interest.id}:${interest.revision}:${input.candidates.duplicateGroup(id)}`);
    }
    for (const [id, rows] of changed) {
      for (const interest of currentInterests) {
        const group = rows.filter(row => row.interestId === interest.id && row.interestRevision === interest.revision);
        if (!group.length || group.every(row => row.settlementApplied) || group.some(row => row.status === 'pending'))
          continue;
        const count = new Set(group.flatMap(row => row.admittedContentIds).map(contentId => input.candidates.duplicateGroup(contentId))).size;
        if (count || group.every(row => row.status === 'completed')) {
          const failures = count ? 0 : (state.backoff[interest.id]?.revision === interest.revision ? state.backoff[interest.id]!.failures : 0) + 1;
          state.backoff[interest.id] = { revision: interest.revision, failures, nextAt: failures ? now() + Math.min(config.candidateSupply.maxSearchBackoffHours * 60, config.candidateSupply.maintenanceIntervalMinutes * 2 ** (failures - 1)) * 60000 : now() };
        }
        for (const row of group)
          row.settlementApplied = true;
      }
      discovery.saveYield(id, rows);
    }
    discovery.saveState({ backoff: state.backoff });
  }
}
