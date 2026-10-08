/* Runs bounded, versioned extraction independently of final knowledge consolidation. */
import type { ModelSelection } from '../contracts';
import type { DatabaseConnection } from '../storage/index';
import type { MemorySources, MemorySourceSnapshot } from './source-contracts';
import type { ExtractionBatchResult, ExtractionModel, MemoryConfiguration, MemoryExtraction } from './extraction-contracts';
import { randomUUID } from 'node:crypto';
import { createExtractionStore, type ExtractionLease } from './extraction-store';
import { selectExtractionSources } from './extraction-selection';
import { buildExtractionInput } from './extraction-input';
import { z } from 'zod';
import type { Observability, RecordedOutcome } from '../observability/index';
import type { ExtractionJob, ExtractionSourceFailure } from './extraction-contracts';

const OutputSchema = z.object({ rawMemory: z.string(), rolloutSummary: z.string(), rolloutSlug: z.string() }).strict()
  .refine(value => (!value.rawMemory && !value.rolloutSummary && !value.rolloutSlug)
    || (!!value.rawMemory.trim() && !!value.rolloutSummary.trim()));

function outcome(jobs: readonly ExtractionJob[]): RecordedOutcome {
  const failed = jobs.find(job => job.status === 'failed');
  if (failed) return { status: 'error', code: failed.error?.code ?? 'EXTRACTION_FAILED', message: 'Memory extraction failed.' };
  return jobs.some(job => job.status === 'cancelled' || job.status === 'superseded') ? { status: 'cancelled' } : { status: 'ok' };
}

export interface MemoryExtractionOptions {
  readonly database: DatabaseConnection;
  readonly sources: MemorySources;
  readonly readConfiguration: () => MemoryConfiguration;
  readonly resolveModel: (selection: ModelSelection) => Promise<ExtractionModel>;
  readonly workspaceDirectory: (workspaceId: string) => string;
  readonly now?: () => number;
  readonly observability?: Observability;
}

export function createMemoryExtraction(options: MemoryExtractionOptions): MemoryExtraction {
  const store = createExtractionStore(options.database);
  const now = options.now ?? Date.now;
  const iso = () => new Date(now()).toISOString();
  let stopped = false;
  const controllers = new Set<AbortController>();
  const pending = new Set<Promise<ExtractionBatchResult>>();
  type Request = NonNullable<Parameters<MemoryExtraction['extract']>[0]>;

  function check(lease: ExtractionLease, signal: AbortSignal): void {
    if (stopped || signal.aborted || !options.readConfiguration().generateMemories) throw new Error('CANCELLED');
    if (!store.isCurrent(lease, iso())) throw new Error('SOURCE_CHANGED');
  }

  async function extractSource(source: MemorySourceSnapshot, lease: ExtractionLease, model: ExtractionModel, signal: AbortSignal): Promise<void> {
    const started = now();
    let coverage: ReturnType<typeof buildExtractionInput>['coverage'] | undefined;
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      check(lease, signal);
      const maxTokens = Math.min(8192, model.model.maxTokens);
      const input = buildExtractionInput({ source, workspaceDirectory: options.workspaceDirectory(source.workspaceId),
        contextWindow: model.model.contextWindow, maxOutputTokens: maxTokens, secrets: model.secrets });
      coverage = input.coverage;
      const controller = new AbortController();
      let rejectWait!: (error: Error) => void;
      const interrupted = new Promise<never>((_, reject) => { rejectWait = reject; });
      // Settle the owning operation first so an immediate provider rejection cannot turn cancellation into failure.
      const interrupt = (code: string) => { rejectWait(new Error(code)); controller.abort(); };
      const abort = () => interrupt('CANCELLED');
      signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(() => interrupt('MODEL_TIMEOUT'), 180000);
      const monitor = setInterval(() => {
        try { check(lease, signal); } catch (error) { interrupt(error instanceof Error ? error.message : 'STORAGE_FAILED'); }
      }, 250);
      let response;
      try {
        const call = async () => {
          try { return await Promise.race([interrupted, model.complete({ systemPrompt: input.systemPrompt,
            messages: [{ role: 'user', content: input.prompt, timestamp: now() }] }, { maxTokens, signal: controller.signal })]); }
          catch (error) {
            const code = error instanceof Error && ['CANCELLED', 'SOURCE_CHANGED', 'MODEL_TIMEOUT'].includes(error.message) ? error.message : 'MODEL_FAILED';
            throw new Error(code);
          }
        };
        response = options.observability ? await options.observability.withSpan({ name: 'model.call' }, call) : await call();
      } finally {
        clearTimeout(timeout); clearInterval(monitor); signal.removeEventListener('abort', abort);
      }
      inputTokens = response.usage.input;
      outputTokens = response.usage.output;
      check(lease, signal);
      const current = options.sources.readSnapshot(source.sessionId);
      if (current.status !== 'found' || current.snapshot.sourceVersion !== source.sourceVersion) throw new Error('SOURCE_CHANGED');
      if (response.stopReason === 'error') throw new Error('MODEL_FAILED');
      if (response.stopReason !== 'stop' || response.content.some(block => block.type === 'toolCall')) throw new Error('INVALID_RESULT');
      const text = response.content.filter(block => block.type === 'text').map(block => block.text).join('');
      if (Buffer.byteLength(text, 'utf8') > 1048576) throw new Error('INVALID_RESULT');
      let output;
      try { output = OutputSchema.parse(JSON.parse(text)); } catch { throw new Error('INVALID_RESULT'); }
      if (!store.complete({ lease, source, output, coverage: input.coverage, now: iso(),
        result: { coverage: input.coverage, durationMs: now() - started, inputTokens: response.usage.input, outputTokens: response.usage.output } })) throw new Error('SOURCE_CHANGED');
    } catch (error) {
      const code = error instanceof Error && ['CANCELLED', 'SOURCE_CHANGED', 'INVALID_RESULT', 'BUDGET_EXCEEDED', 'MODEL_TIMEOUT', 'STORAGE_FAILED'].includes(error.message) ? error.message : 'MODEL_FAILED';
      store.settle(lease, code === 'CANCELLED' ? 'cancelled' : code === 'SOURCE_CHANGED' ? 'superseded' : 'failed', iso(),
        { code, message: 'Extraction did not commit; inspect the job code before retrying.' });
    } finally {
      const job = store.getJob(lease.jobId);
      if (job && job.status !== 'running') options.observability?.recordEvent({ type: 'memory.extraction.settled',
        jobId: job.jobId, sourceVersion: job.sourceVersion, attempt: job.attempt, status: job.status,
        durationMs: Math.max(0, now() - started), includedMessages: coverage?.includedMessageIds.length ?? 0,
        omittedMessages: coverage?.omittedMessageIds.length ?? 0, inputTokens, outputTokens,
        ...(job.error ? { errorCode: job.error.code } : {}) });
    }
  }

  async function run(request: Request, signal: AbortSignal, runId: string): Promise<ExtractionBatchResult> {
    if (stopped) return { status: 'skipped', reason: 'stopped' };
    const configuration = options.readConfiguration();
    if (!configuration.generateMemories) return { status: 'skipped', reason: 'disabled' };
    const selected = selectExtractionSources({ sources: options.sources.listSources({ limit: 5000 }), configuration, now: now(), triggerSessionId: request.triggerSessionId });
    if (!selected.length) {
      store.beginRun(runId, iso(), !!request.failedJobId);
      request.onProgress?.(runId);
      return { status: 'completed', stage: 'extract', runId, result: store.finishRun(runId, iso()), jobs: [], sourceFailures: [] };
    }
    if (!configuration.extractModel) return { status: 'failed', error: { code: 'MODEL_UNAVAILABLE', message: 'Configure an extraction model.' } };
    let model: ExtractionModel;
    try { model = await options.resolveModel(configuration.extractModel); }
    catch { return { status: 'failed', error: { code: 'MODEL_UNAVAILABLE', message: 'The extraction model is unavailable.' } }; }
    if (signal.aborted || stopped || !options.readConfiguration().generateMemories) return { status: 'skipped', reason: 'stopped' };
    store.beginRun(runId, iso(), !!request.failedJobId);
    request.onProgress?.(runId);
    let count = 0;
    let cursor = 0;
    const sourceFailures: ExtractionSourceFailure[] = [];
    async function worker() {
      while (cursor < selected.length && count < configuration.maxSourcesPerRun && !signal.aborted && !stopped && options.readConfiguration().generateMemories) {
        const info = selected[cursor++];
        const current = selectExtractionSources({ sources: options.sources.listSources({ sessionId: info.sessionId }),
          configuration, now: now(), triggerSessionId: request.triggerSessionId });
        if (!current.length) continue;
        const read = options.sources.readSnapshot(info.sessionId);
        if (read.status !== 'found') {
          sourceFailures.push({ sessionId: info.sessionId, error: {
            code: read.status === 'failed' ? read.error.code : 'SOURCE_UNAVAILABLE', message: 'The original source could not be read.' } });
          continue;
        }
        const source = read.snapshot;
        const lease = store.claim({ runId, jobId: randomUUID(), ownerToken: randomUUID(), source, now: iso(), failedJobId: request.failedJobId });
        if (!lease) continue;
        count++;
        request.onProgress?.(runId);
        const operation = () => extractSource(source, lease, model, signal);
        if (options.observability) await options.observability.withSpan({ name: 'memory.extract',
          correlation: { executionId: runId, sessionId: source.sessionId, workspaceId: source.workspaceId,
            modelCallId: lease.jobId, contentDigest: source.sourceVersion },
          classifyResult: () => ({ outcome: outcome([store.getJob(lease.jobId)!]) }),
        }, operation);
        else await operation();
        request.onProgress?.(runId);
      }
    }
    const workers = await Promise.allSettled(Array.from({ length: 8 }, worker));
    if (workers.some(worker => worker.status === 'rejected')) return { status: 'failed', error: { code: 'STORAGE_FAILED', message: 'Extraction state could not be saved.' } };
    const result = store.finishRun(runId, iso(), sourceFailures);
    return { status: 'completed', stage: 'extract', runId, result, jobs: store.listJobs(runId), sourceFailures };
  }
  return {
    extract(request = {}) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (request.signal?.aborted) controller.abort();
      request.signal?.addEventListener('abort', abort, { once: true });
      controllers.add(controller);
      const runId = randomUUID();
      const execute = async (): Promise<ExtractionBatchResult> => {
        try { return await run(request, controller.signal, runId); }
        catch { return { status: 'failed', error: { code: 'STORAGE_FAILED', message: 'Extraction state could not be read or saved.' } }; }
      };
      const traced = options.observability ? options.observability.withTrace({ kind: 'memory_extraction', correlation: { executionId: runId },
        classifyResult: result => ({ outcome: result.status === 'completed' ? (result.sourceFailures.length
          ? { status: 'error', code: 'SOURCE_UNAVAILABLE', message: 'Some original sources could not be read.' } : outcome(result.jobs))
          : result.status === 'failed' ? { status: 'error', ...result.error } : { status: 'ok' } }),
      }, execute) : execute();
      const operation = traced.finally(() => {
        controllers.delete(controller); pending.delete(operation); request.signal?.removeEventListener('abort', abort);
      });
      pending.add(operation);
      return operation;
    },
    getJob: store.getJob, listJobs: store.listJobs, getExtraction: store.getExtraction,
    async cancelActive() { controllers.forEach(controller => controller.abort()); await Promise.allSettled([...pending]); },
    async shutdown() { stopped = true; controllers.forEach(controller => controller.abort()); await Promise.allSettled([...pending]); },
  };
}
