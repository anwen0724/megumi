/* Composes extraction, file consolidation and explicit maintenance in the application. */
import type { MemoryChanged } from './wire-contracts';
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '../storage/index';
import type { Settings } from '../settings/settings-store';
import type { ModelSelection } from '../contracts';
import type { Observability } from '../observability/index';
import type { MemorySources } from './source-contracts';
import type { MemoryFiles } from './memory-files';
import type { MemoryExtraction } from './extraction-contracts';
import type { MemoryFailure, MemoryGenerationRequest, MemoryHost, MemoryRun, MemoryStartResult, MemoryManagedSource, MemoryJob } from './contracts';
import { createMemoryStore, type MemoryWriter } from './memory-store';
import { selectConsolidationSources, readSuccessfulSources } from './consolidation-selection';
import { publishConsolidationInputs, validateMemoryArtifacts, validateMemoryDocument } from './consolidation-documents';
import { runConsolidationAgent, type ConsolidationModel } from './consolidation-agent';

export interface MemoryProductionOptions {
  readonly database: DatabaseConnection; readonly settings: Settings; readonly files: MemoryFiles;
  readonly sources: MemorySources; readonly extraction: MemoryExtraction; readonly root: string;
  readonly resolveModel: (selection: ModelSelection) => Promise<ConsolidationModel>;
  readonly now?: () => number; readonly observability?: Observability;
}
export function createMemoryProduction(options: MemoryProductionOptions): Omit<MemoryHost, 'getStatus' | 'createTaskMemory' | 'searchDocuments' | 'readSource' | 'recordUsage'> & { inspect(): void } {
  const { database, settings, files, sources } = options;
  const now = options.now ?? Date.now;
  const iso = () => new Date(now()).toISOString();
  const store = createMemoryStore(database, now);
  let stopped = false;
  const processInstanceId = randomUUID();
  let sequence = 0;
  const listeners = new Set<(event: MemoryChanged) => void>();
  function changed(runId?: string): void {
    const event = { processInstanceId, sequence: ++sequence, revision: store.state().dirty_revision, ...(runId ? { runId } : {}) };
    for (const listener of listeners) {
      try { listener(event); } catch { /* A disconnected UI cannot fail a committed operation. */ }
    }
  }
  let active: { runId: string; controller: AbortController; completion: Promise<void>; followup?: MemoryGenerationRequest; targetRevision?: number } | undefined;
  let clearing: Promise<void> | undefined;
  const failure = (error: unknown): MemoryFailure => ({ status: 'failed', error: {
    code: error instanceof Error && /^[A-Z_]+(?::|$)/.test(error.message) ? error.message.split(':')[0] : 'STORAGE_FAILED',
    message: 'Memory operation could not complete. Existing sources were preserved.',
  } });
  function configuration() {
    const read = settings.readSettings();
    if (read.status !== 'ok') throw new Error('SETTINGS_INVALID');
    return read.settings.config.memory;
  }
  const versions = () => Object.fromEntries(files.list().map(document => [document.path, document.version]));
  const selection = () => selectConsolidationSources({ database, sources, configuration: configuration(), now: now() });
  function inspect(): void {
    let actual: Record<string, string>;
    try { actual = versions(); } catch { store.recover(undefined); store.markRepair(); return; }
    store.recover(actual);
    const state = store.state();
    if (state.clear_pending || state.writer_token) return;
    if (state.artifact_state === 'ready') {
      const saved = readSuccessfulSources(database);
      const invalid = saved.some(source => {
        const original = sources.readSnapshot(source.sessionId);
        return original.status !== 'found' || original.snapshot.sourceVersion !== source.sourceVersion || !database.prepare({ sql: `SELECT 1 FROM memory_sources s
          JOIN memory_current_extractions c ON c.session_id = s.session_id WHERE s.session_id = ? AND s.eligibility = 'eligible' AND c.source_version = ?` }).get([source.sessionId, source.sourceVersion]);
      });
      if (invalid) {
        if (state.dirty_revision === state.processed_revision) store.dirty();
        store.markRepair(); return;
      }
      if (JSON.stringify(actual) !== state.artifact_versions_json) {
        try {
          validateMemoryArtifacts(files, { targetRevision: state.processed_revision, selected: saved, previous: saved, added: [], removed: [], retained: saved });
          const writer = store.acquire();
          try {
            store.assertWriter(writer);
            database.prepare({ sql: 'UPDATE memory_state SET artifact_versions_json = ?, dirty_revision = dirty_revision + 1 WHERE id = 1' }).run([JSON.stringify(actual)]);
          } finally { store.release(writer); }
        } catch { store.markRepair(); }
      }
    } else if (state.artifact_state === 'empty' && files.hasArtifacts()) store.markRepair();
  }
  function getRun(runId: string): MemoryRun | undefined {
    const row = database.prepare<{ run_id: string; kind: string; status: MemoryRun['status']; created_at: string; completed_at: string | null; result_json: string | null }>({ sql: "SELECT * FROM memory_runs WHERE run_id = ? AND kind <> 'extract'" }).get([runId]);
    if (!row) return undefined;
    const result = row.result_json ? JSON.parse(row.result_json) : undefined;
    const jobs = database.prepare<{ job_id: string; stage: MemoryJob['stage']; status: MemoryJob['status']; attempt: number;
      retry_group_id: string; retry_of_job_id: string | null; retry_at: string | null; session_id: string | null; source_version: string | null;
      target_revision: number | null; error_json: string | null; result_json: string | null }>({ sql: 'SELECT * FROM memory_jobs WHERE run_id IN (?,?) ORDER BY started_at,job_id' }).all([runId, result?.extractionRunId ?? '']);
    return { runId, kind: row.kind, status: row.status, createdAt: row.created_at,
      ...(row.completed_at ? { completedAt: row.completed_at } : {}), ...(result ? { result } : {}),
      jobs: jobs.map(job => ({ jobId: job.job_id, stage: job.stage, status: job.status, attempt: job.attempt,
        retryGroupId: job.retry_group_id, retryOfJobId: job.retry_of_job_id ?? undefined, retryAt: job.retry_at ?? undefined,
        sourceId: job.session_id ?? undefined, sourceVersion: job.source_version ?? undefined, targetRevision: job.target_revision ?? undefined,
        ...(job.error_json ? { error: JSON.parse(job.error_json) } : {}), ...(job.result_json ? { result: JSON.parse(job.result_json) } : {}) })) };
  }
  function gc(writer: MemoryWriter): void {
    store.assertWriter(writer);
    const cutoff = new Date(now() - configuration().maxUnusedDays * 86400000).toISOString();
    const candidates = database.prepare<{ session_id: string; source_version: string; current_version: string | null; eligibility: string; last_use: string }>({ sql: `SELECT e.session_id,e.source_version,c.source_version AS current_version,s.eligibility,
      max(COALESCE(s.last_used_at,e.source_updated_at),e.source_updated_at) AS last_use FROM memory_extractions e
      JOIN memory_sources s ON s.session_id = e.session_id LEFT JOIN memory_current_extractions c ON c.session_id = e.session_id
      WHERE NOT EXISTS (SELECT 1 FROM memory_snapshot_sources r WHERE r.session_id = e.session_id AND r.source_version = e.source_version)
      AND NOT EXISTS (SELECT 1 FROM memory_jobs j WHERE j.session_id = e.session_id AND j.source_version = e.source_version AND j.status IN ('pending','running'))` }).all();
    for (const candidate of candidates) {
      const source = sources.readSnapshot(candidate.session_id);
      if (source.status === 'failed' && source.error.code === 'STORAGE_FAILED') continue;
      const obsolete = candidate.current_version !== candidate.source_version || candidate.eligibility === 'excluded'
        || candidate.last_use < cutoff || source.status !== 'found';
      if (!obsolete) continue;
      const key = createHash('sha256').update(candidate.session_id).digest('hex');
      files.removeInput(`rollout_summaries/${key}-${candidate.source_version}.md`, () => store.assertWriter(writer));
      database.transaction({ operation: () => {
        store.assertWriter(writer);
        database.prepare({ sql: 'DELETE FROM memory_current_extractions WHERE session_id = ? AND source_version = ?' }).run([candidate.session_id, candidate.source_version]);
        database.prepare({ sql: 'DELETE FROM memory_extractions WHERE session_id = ? AND source_version = ?' }).run([candidate.session_id, candidate.source_version]);
      } });
    }
  }
  async function consolidate(runId: string, controller: AbortController, maintenance: boolean, failedJobId?: string): Promise<'generated' | 'unchanged' | 'empty'> {
    inspect();
    const writer = store.acquire();
    const before = store.state();
    let baseline: Record<string, string> | undefined;
    try { baseline = versions(); } catch { /* The Agent can delete and replace malformed final files. */ }
    let jobId: string | undefined;
    const guard = () => {
      if (controller.signal.aborted && controller.signal.reason?.message === 'TIMEOUT') throw new Error('TIMEOUT');
      if (stopped || controller.signal.aborted || (!maintenance && !configuration().generateMemories)) throw new Error('CANCELLED');
      if (database.prepare<{ cancel_requested: number }>({ sql: 'SELECT cancel_requested FROM memory_runs WHERE run_id = ?' }).get([runId])?.cancel_requested) throw new Error('CANCELLED');
      store.assertWriter(writer);
    };
    const renew = setInterval(() => { try { guard(); store.renew(writer); } catch { controller.abort(); } }, 90000);
    const monitor = setInterval(() => { try { guard(); } catch { controller.abort(); } }, 250);
    const timeout = setTimeout(() => controller.abort(new Error('TIMEOUT')), 900000);
    try {
      guard();
      files.discardTemporary(guard);
      let chosen = selection();
      if ((chosen.added.length || chosen.removed.length) && before.dirty_revision === before.processed_revision) {
        store.dirty(); chosen = selection();
      }
      if (active?.runId === runId) active.targetRevision = chosen.targetRevision;
      if (!chosen.selected.length && !chosen.previous.length && !files.hasArtifacts()) {
        database.prepare({ sql: "UPDATE memory_state SET processed_revision = ?, artifact_state = 'empty' WHERE id = 1" }).run([chosen.targetRevision]);
        return 'empty';
      }
      if (!chosen.added.length && !chosen.removed.length && before.dirty_revision === before.processed_revision && before.artifact_state === 'ready') { gc(writer); return 'unchanged'; }
      jobId = store.claimJob(writer, runId, chosen, failedJobId);
      if (!jobId) throw new Error('RETRY_DEFERRED');
      const config = configuration();
      if (!config.consolidationModel) throw new Error('MODEL_UNAVAILABLE');
      const model = await options.resolveModel(config.consolidationModel);
      guard();
      changed(runId);
      publishConsolidationInputs(files, chosen, guard);
      const operation = () => runConsolidationAgent({ model, files, root: options.root, selection: chosen, signal: controller.signal, guard, observability: options.observability });
      const result = await operation();
      guard();
      // Re-read after the last tool: an external edit cannot be certified by an older finish result.
      const finalVersions = validateMemoryArtifacts(files, chosen);
      if (JSON.stringify(finalVersions) !== JSON.stringify(result.versions)) throw new Error('SOURCE_CHANGED');
      database.transaction({ operation: () => {
        guard();
        for (const source of chosen.selected) {
          const current = sources.readSnapshot(source.sessionId);
          if (current.status !== 'found' || current.snapshot.sourceVersion !== source.sourceVersion) throw new Error('SOURCE_CHANGED');
        }
        store.commit(writer, jobId!, chosen, finalVersions, result);
      } });
      try { options.observability?.recordEvent({ type: 'memory.snapshot.committed', runId, jobId: jobId!, snapshotId: store.state().successful_snapshot_id! }); }
      catch { /* Diagnostics do not change a committed snapshot. */ }
      gc(writer);
      publishConsolidationInputs(files, { ...chosen, removed: [] }, guard);
      return 'generated';
    } catch (error) {
      const code = controller.signal.reason?.message === 'TIMEOUT' ? 'TIMEOUT' : failure(error).error.code;
      if (jobId) store.settleJob(writer, jobId, code === 'SOURCE_CHANGED' || code === 'OWNER_LOST' ? 'superseded' : code === 'CANCELLED' && !controller.signal.reason?.message?.includes('TIMEOUT') ? 'cancelled' : 'failed', code);
      const current = store.state();
      if (current.writer_token === writer.token && !current.clear_pending) {
        let intact = false;
        try { intact = JSON.stringify(versions()) === JSON.stringify(baseline); } catch { /* Unreadable files require repair. */ }
        database.prepare({ sql: 'UPDATE memory_state SET artifact_state = ? WHERE id = 1' }).run([intact ? before.artifact_state : 'needsRepair']);
      }
      throw code === 'TIMEOUT' ? new Error('TIMEOUT') : error;
    } finally { clearInterval(renew); clearInterval(monitor); clearTimeout(timeout); store.release(writer); }
  }
  async function execute(runId: string, request: MemoryGenerationRequest, controller: AbortController, maintenance: boolean): Promise<void> {
    let extractionRunId: string | undefined;
    let extractionError: MemoryFailure['error'] | undefined;
    let extractionFailed = false; let extracted = false;
    try {
      if (!maintenance) {
        const failedJob = request.failedJobId ? database.prepare<{ stage: string }>({ sql: 'SELECT stage FROM memory_jobs WHERE job_id = ?' }).get([request.failedJobId]) : undefined;
        const result = await options.extraction.extract({ triggerSessionId: request.triggerSessionId,
          onProgress: extractionId => {
            database.prepare({ sql: 'UPDATE memory_runs SET result_json = ? WHERE run_id = ?' }).run([JSON.stringify({ extractionRunId: extractionId }), runId]);
            changed(runId);
          },
          ...(failedJob?.stage === 'extract' ? { failedJobId: request.failedJobId } : {}), signal: controller.signal });
        if (result.status === 'completed') {
          extractionRunId = result.runId; extractionFailed = ['failed', 'partial', 'cancelled'].includes(result.result);
          extracted = result.jobs.some(job => job.status === 'succeeded');
          extractionError = result.sourceFailures[0]?.error ?? result.jobs.find(job => job.status === 'failed')?.error;
          database.prepare({ sql: 'UPDATE memory_runs SET result_json = ? WHERE run_id = ?' }).run([JSON.stringify({ extractionRunId }), runId]);
        } else if (result.status === 'failed') {
          extractionFailed = true;
          extractionError = result.error;
        }
      }
      if (controller.signal.aborted) throw new Error('CANCELLED');
      const failed = request.failedJobId ? database.prepare<{ stage: string }>({ sql: 'SELECT stage FROM memory_jobs WHERE job_id = ?' }).get([request.failedJobId]) : undefined;
      const consolidation = () => consolidate(runId, controller, maintenance, failed?.stage === 'consolidate' ? request.failedJobId : undefined);
      const result = options.observability ? await options.observability.withSpan({ name: 'memory.consolidate' }, consolidation) : await consolidation();
      if (extractionFailed && !extracted && result !== 'generated') {
        store.finishRun(runId, 'failed', { extractionRunId, error: extractionError ?? { code: 'EXTRACTION_FAILED', message: 'Memory extraction did not complete.' } });
      } else store.finishRun(runId, 'completed', { result: extractionFailed ? 'partial' : result, extractionRunId,
        ...(extractionFailed && extractionError ? { error: extractionError } : {}) });
    } catch (error) {
      const failed = failure(error);
      store.finishRun(runId, controller.signal.aborted && failed.error.code !== 'TIMEOUT' ? 'cancelled' : extracted ? 'completed' : 'failed', { result: extracted ? 'partial' : undefined, extractionRunId, error: failed.error });
    }
  }
  function launch(runId: string, request: MemoryGenerationRequest, maintenance: boolean): void {
    const controller = new AbortController();
    const operation = async () => { await execute(runId, request, controller, maintenance); };
    const completion = Promise.resolve().then(() => options.observability
      ? options.observability.withTrace({ kind: 'memory_generation', correlation: { executionId: runId }, classifyResult: () => {
        const run = getRun(runId);
        return { outcome: run?.status === 'cancelled' ? { status: 'cancelled' }
          : run?.status === 'failed' || run?.jobs.some(job => job.status === 'failed' || job.status === 'superseded')
            ? { status: 'error', code: 'MEMORY_GENERATION_FAILED', message: 'Some memory work did not complete.' } : { status: 'ok' } };
      } }, operation) : operation())
      .finally(() => {
        changed(runId);
        const followup = active?.runId === runId
          ? active.followup ?? (active.targetRevision !== undefined && store.state().dirty_revision > active.targetRevision ? request : undefined)
          : undefined;
        if (active?.runId === runId) active = undefined;
        if (followup && !stopped && !store.state().clear_pending && !controller.signal.aborted) start({ ...followup, requestId: randomUUID() }, maintenance);
      });
    active = { runId, controller, completion };
    changed(runId);
    // The background promise can outlive its caller. Trace records failures; shutdown still observes rejection.
    void completion.catch(() => {});
  }
  function start(request: MemoryGenerationRequest, maintenance = false): MemoryStartResult {
    try {
      if (stopped) return { status: 'skipped', reason: 'stopped' };
      if (store.state().clear_pending) throw new Error('BUSY');
      if (!maintenance && !configuration().generateMemories) return { status: 'skipped', reason: 'disabled' };
      if (!['startup', 'manual', 'retry'].includes(request.reason) || (request.reason === 'retry' && !request.failedJobId)) throw new Error('INVALID_ARGUMENT');
      if (request.failedJobId && !database.prepare({ sql: "SELECT 1 FROM memory_jobs WHERE job_id = ? AND status = 'failed'" }).get([request.failedJobId])) throw new Error('INVALID_ARGUMENT');
      const result = store.request<MemoryStartResult>('generate', request.requestId, request, () => {
        if (active) { active.followup = request; return { status: 'reused', runId: active.runId }; }
        inspect();
        const runId = randomUUID(); store.beginRun(runId, maintenance ? 'maintenance' : request.reason);
        return { status: 'started', runId };
      });
      if (result.status === 'started' && !active && getRun(result.runId)?.status === 'running') launch(result.runId, request, maintenance);
      return result;
    } catch (error) { return failure(error); }
  }
  async function performClear(runId: string): Promise<void> {
    try {
      const read = settings.readSettings();
      if (read.status !== 'ok') throw new Error('SETTINGS_INVALID');
      const saved = settings.updateSettings({ expectedRevision: read.settings.revision, patch: { memory: { generateMemories: false, useMemories: false } } });
      if (saved.status === 'rejected') throw new Error('SETTINGS_INVALID');
      active?.controller.abort();
      await options.extraction.cancelActive();
      await active?.completion;
      if (stopped) throw new Error('CANCELLED');
      let writer: MemoryWriter;
      for (;;) {
        if (stopped) throw new Error('CANCELLED');
        try { writer = store.acquire(true); break; }
        catch (error) {
          if (failure(error).error.code !== 'BUSY') throw error;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      try {
        const guard = () => { if (stopped) throw new Error('CANCELLED'); store.assertWriter(writer, true); };
        files.clear(guard);
        database.transaction({ operation: () => {
          guard();
          database.prepare({ sql: 'UPDATE memory_state SET successful_snapshot_id = NULL WHERE id = 1' }).run();
          for (const table of ['memory_usage_receipts', 'memory_snapshot_sources', 'memory_snapshots', 'memory_current_extractions', 'memory_extractions', 'memory_jobs']) database.prepare({ sql: `DELETE FROM ${table}` }).run();
          database.prepare({ sql: 'DELETE FROM memory_runs WHERE run_id <> ?' }).run([runId]);
          database.prepare({ sql: 'UPDATE memory_sources SET usage_count = 0, last_used_at = NULL' }).run();
          store.finishRun(runId, 'completed', { result: 'empty' });
          database.prepare({ sql: `UPDATE memory_state SET artifact_state = 'empty', dirty_revision = 0, processed_revision = 0,
            artifact_versions_json = '{}', reply_cursor = max(reply_cursor,clear_reply_cursor), clear_pending = 0 WHERE id = 1` }).run();
        } });
      } finally { store.release(writer); }
    } catch (error) { store.finishRun(runId, 'failed', { error: failure(error).error }); }
  }
  function page<T>(items: readonly T[], request: { cursor?: string; limit?: number }, identity: (item: T) => string) {
    const limit = request.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('INVALID_ARGUMENT');
    const revision = createHash('sha256').update(JSON.stringify(items)).digest('hex');
    let after = '';
    if (request.cursor) {
      let cursor;
      try { cursor = JSON.parse(Buffer.from(request.cursor, 'base64url').toString()); } catch { throw new Error('INVALID_ARGUMENT'); }
      if (cursor.revision !== revision) throw new Error('VERSION_CONFLICT');
      after = cursor.after;
    }
    const remaining = items.filter(item => identity(item) > after);
    const selected = remaining.slice(0, limit);
    return { items: selected, ...(remaining.length > limit ? { nextCursor: Buffer.from(JSON.stringify({ revision, after: identity(selected[selected.length - 1]) })).toString('base64url') } : {}) };
  }
  const host: ReturnType<typeof createMemoryProduction> = {
    subscribeChanges(handler) { listeners.add(handler); return () => { listeners.delete(handler); }; },
    inspect, startGeneration: request => start(request), getRun,
    async waitRun(request) {
      const timeout = request.timeoutMs ?? 60000;
      if (!Number.isInteger(timeout) || timeout < 0 || timeout > 60000) return failure(new Error('INVALID_ARGUMENT'));
      const deadline = Date.now() + timeout;
      for (;;) {
        const run = getRun(request.runId);
        if (!run) return { status: 'notFound' };
        if (!['pending', 'running'].includes(run.status)) return { status: 'completed', run };
        if (Date.now() >= deadline || request.signal?.aborted) return { status: 'timeout', run };
        await new Promise(resolve => setTimeout(resolve, Math.min(50, deadline - Date.now())));
      }
    },
    cancelRun(request) {
      try { return store.request('cancel', request.requestId, request, () => {
        const run = getRun(request.runId);
        if (!run) return { status: 'notFound' as const };
        if (run.kind === 'clear') throw new Error('INVALID_ARGUMENT');
        if (!['pending', 'running'].includes(run.status)) return { status: 'alreadyFinished' as const };
        database.prepare({ sql: 'UPDATE memory_runs SET cancel_requested = 1 WHERE run_id = ?' }).run([request.runId]);
        if (active?.runId === request.runId) active.controller.abort();
        return { status: 'cancelling' as const };
      }); } catch (error) { return failure(error); }
    },
    listDocuments(request = {}) {
      try {
        inspect();
        const result = page(files.paths().map(path => ({ path, version: files.readLines(path, 1, 1)!.version, readOnly: path === 'raw_memories.md' || path.startsWith('rollout_summaries/') })), request, item => item.path);
        return { status: 'ok', documents: result.items, nextCursor: result.nextCursor };
      } catch (error) { return failure(error); }
    },
    readDocument(request) {
      try {
        inspect();
        const document = files.readLines(request.path, request.startLine, request.lineCount, request.startCharacter);
        if (!document) return { status: 'notFound' };
        if (request.expectedVersion && request.expectedVersion !== document.version) throw new Error('VERSION_CONFLICT');
        return { status: 'found', document };
      } catch (error) { return failure(error); }
    },
    updateDocument(request) {
      let writer: MemoryWriter | undefined;
      let before: ReturnType<typeof store.state> | undefined;
      let baseline: Record<string, string> | undefined;
      try {
        inspect();
        const cached = store.cachedRequest<ReturnType<MemoryHost['updateDocument']>>('edit', request.requestId, request);
        if (cached) return cached;
        writer = store.acquire(); before = store.state(); baseline = versions();
        validateMemoryDocument({ ...request, version: request.expectedVersion, readOnly: false }, selection().selected);
        database.prepare({ sql: "UPDATE memory_state SET artifact_state = 'updating' WHERE id = 1" }).run();
        const owner = writer;
        const document = files.writeFinal(request, () => store.assertWriter(owner));
        const priorState = before.artifact_state;
        return store.request('edit', request.requestId, request, () => {
            store.assertWriter(owner);
            store.dirty();
            database.prepare({ sql: 'UPDATE memory_state SET artifact_versions_json = ?, artifact_state = ? WHERE id = 1' }).run([JSON.stringify(versions()), priorState]);
            return { status: 'saved' as const, document };
        });
      } catch (error) {
        if (writer && before && store.state().writer_token === writer.token) {
          let intact = false;
          try { intact = JSON.stringify(versions()) === JSON.stringify(baseline); } catch { /* Invalid files stay unavailable. */ }
          database.prepare({ sql: 'UPDATE memory_state SET artifact_state = ? WHERE id = 1' }).run([intact ? before.artifact_state : 'needsRepair']);
        }
        return failure(error);
      } finally { if (writer) { store.release(writer); changed(); } }
    },
    listSources(request = {}) {
      try {
        const selected = new Set(database.prepare<{ session_id: string }>({ sql: 'SELECT session_id FROM memory_snapshot_sources WHERE snapshot_id = (SELECT successful_snapshot_id FROM memory_state WHERE id = 1)' }).all().map(row => row.session_id));
        const items: MemoryManagedSource[] = sources.listSources().map(source => {
          const saved = database.prepare<{ eligibility: 'eligible' | 'excluded'; eligibility_version: number; usage_count: number; last_used_at: string | null; source_version: string | null }>({ sql: 'SELECT s.*,c.source_version FROM memory_sources s LEFT JOIN memory_current_extractions c ON c.session_id = s.session_id WHERE s.session_id = ?' }).get([source.sessionId]);
          const snapshot = sources.readSnapshot(source.sessionId);
          return { sessionId: source.sessionId, title: source.title, workspaceId: source.workspaceId, contentUpdatedAt: source.contentUpdatedAt,
            ...(snapshot.status === 'found' ? { sourceRef: snapshot.snapshot.sourceRef } : {}), eligibility: saved?.eligibility ?? 'eligible', version: saved?.eligibility_version ?? 0,
            usageCount: saved?.usage_count ?? 0, lastUsedAt: saved?.last_used_at ?? undefined, extractionVersion: saved?.source_version ?? undefined, selected: selected.has(source.sessionId) };
        }).sort((a, b) => a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0);
        const result = page(items, request, item => item.sessionId);
        return { status: 'ok', sources: result.items, nextCursor: result.nextCursor };
      } catch (error) { return failure(error); }
    },
    setSourceEligibility(request) {
      try {
        const result = store.request('eligibility', request.requestId, request, () => {
          if (!['eligible', 'excluded'].includes(request.eligibility)) throw new Error('INVALID_ARGUMENT');
          const writer = store.acquire();
          try {
            if (sources.readSnapshot(request.sessionId).status !== 'found') throw new Error('SOURCE_UNAVAILABLE');
            database.prepare({ sql: 'INSERT OR IGNORE INTO memory_sources(session_id,updated_at) VALUES (?,?)' }).run([request.sessionId, iso()]);
            const updated = database.prepare<{ eligibility_version: number }>({ sql: 'UPDATE memory_sources SET eligibility = ?, eligibility_version = eligibility_version + 1, updated_at = ? WHERE session_id = ? AND eligibility_version = ? RETURNING eligibility_version' })
              .get([request.eligibility, iso(), request.sessionId, request.expectedVersion]);
            if (!updated) throw new Error('VERSION_CONFLICT');
            store.dirty();
            const selected = !!database.prepare({ sql: 'SELECT 1 FROM memory_snapshot_sources WHERE snapshot_id = (SELECT successful_snapshot_id FROM memory_state WHERE id = 1) AND session_id = ?' }).get([request.sessionId]);
            if (selected && request.eligibility === 'excluded') store.markRepair();
            return { status: 'saved' as const, version: updated.eligibility_version,
              maintenance: selected && request.eligibility === 'excluded' ? configuration().consolidationModel ? 'pending' as const : 'pendingModel' as const : 'notRequired' as const };
          } finally { store.release(writer); }
        });
        changed();
        if (result.maintenance === 'pending') {
          const started = start({ requestId: `exclude:${request.requestId}`, reason: 'manual' }, true);
          if (started.status === 'started' || started.status === 'reused') return { ...result, runId: started.runId };
        }
        return result;
      } catch (error) { return failure(error); }
    },
    clearMemory(request) {
      try {
        if (request.confirmed !== true || stopped) throw new Error('INVALID_ARGUMENT');
        const result = store.request<Extract<MemoryStartResult, { runId: string }>>('clear', request.requestId, request, () => {
          const existing = store.state().clear_pending ? database.prepare<{ run_id: string }>({ sql: "SELECT run_id FROM memory_runs WHERE kind = 'clear' ORDER BY rowid DESC LIMIT 1" }).get() : undefined;
          if (existing) return { status: 'reused', runId: existing.run_id };
          database.prepare({ sql: "UPDATE memory_state SET clear_pending = 1, artifact_state = 'clearing', control_revision = control_revision + 1, clear_reply_cursor = ? WHERE id = 1" }).run([sources.getReplyCursor()]);
          const runId = randomUUID();
          store.beginRun(runId, 'manual');
          database.prepare({ sql: "UPDATE memory_runs SET kind = 'clear' WHERE run_id = ?" }).run([runId]);
          return { status: 'started', runId };
        });
        const pendingRun = database.prepare<{ run_id: string }>({ sql: "SELECT run_id FROM memory_runs WHERE kind = 'clear' ORDER BY rowid DESC LIMIT 1" }).get();
        if (store.state().clear_pending && !clearing && pendingRun?.run_id === result.runId) {
          database.prepare({ sql: "UPDATE memory_runs SET status = 'running', result_json = NULL, completed_at = NULL WHERE run_id = ?" }).run([result.runId]);
          changed(result.runId);
          clearing = Promise.resolve().then(() => performClear(result.runId)).finally(() => { clearing = undefined; changed(result.runId); });
        }
        return result;
      } catch (error) { return failure(error); }
    },
    async shutdown() {
      stopped = true; active?.controller.abort();
      await options.extraction.shutdown();
      await active?.completion;
      await clearing;
      listeners.clear();
    },
  };
  inspect();
  if (store.state().clear_pending) host.clearMemory({ requestId: `recover-clear:${store.state().control_revision}`, confirmed: true });
  return host;
}
