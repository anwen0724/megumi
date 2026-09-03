/*
 * Owns execution-scoped Candidate Supply Tool state; only explicit submissions reach persistence.
 */
import { randomUUID } from 'node:crypto';
import type { Observability, OperationCompletion, TraceCorrelation } from '@megumi/observability';
import type { RawToolResult } from '@megumi/tools';
import {
  CandidateSupplySearchInputSchema,
  CandidateSupplySubmitInputSchema,
  SourceContentSchema,
  SourceContentDetailSchema,
  type CandidatePoolSettings,
  type CandidatePoolSnapshot,
  type CandidateSupplyRepository,
  type CandidateSupplyTrigger,
} from './candidate-supply';
import type {
  DiscoverySource,
  SourceContent,
  SourceContentDetail,
} from '../sources/discovery-source';
import type { SourceRegistry } from '../sources/source-registry';

interface SourceResult {
  readonly resultId: string;
  readonly source: DiscoverySource;
  content: SourceContent | SourceContentDetail;
}

interface CandidateSupplyAttempt {
  readonly executionId: string;
  readonly startedAt: string;
  readonly trigger: CandidateSupplyTrigger;
  readonly repository: CandidateSupplyRepository;
  readonly sourceRegistry: SourceRegistry;
  readonly enabledSourceIds: ReadonlySet<string>;
  readonly settings: CandidatePoolSettings;
  readonly now: () => string;
  readonly results: Map<string, SourceResult>;
  readonly sourceTails: Map<string, Promise<void>>;
  searchesSucceeded: number;
  sourceFailureCount: number;
  searchResultCount: number;
  submissionCount: number;
  addedCandidateCount: number;
  addedInterestMatchCount: number;
}

export interface CandidateSupplyAttemptSummary {
  readonly searchesSucceeded: number;
  readonly sourceFailureCount: number;
  readonly searchResultCount: number;
  readonly submissionCount: number;
  readonly addedCandidateCount: number;
  readonly addedInterestMatchCount: number;
}

export interface CandidateSupplyAttemptContext {
  readonly executionId: string;
  readonly startedAt: string;
  readonly trigger: CandidateSupplyTrigger;
  readonly snapshot: CandidatePoolSnapshot;
  readonly enabledSourceIds: readonly string[];
}

export interface CandidateSupplyAttempts {
  start(input: {
    readonly executionId: string;
    readonly startedAt: string;
    readonly trigger: CandidateSupplyTrigger;
    readonly repository: CandidateSupplyRepository;
    readonly sourceRegistry: SourceRegistry;
    readonly enabledSourceIds: readonly string[];
    readonly settings: CandidatePoolSettings;
    readonly now: () => string;
  }): void;
  ownsExecution(executionId: string): boolean;
  readContextState(executionId: string): CandidateSupplyAttemptContext | undefined;
  searchContent(request: ToolRequest): Promise<RawToolResult>;
  readSourceCandidate(request: ToolRequest): Promise<RawToolResult>;
  submitCandidates(request: ToolRequest): Promise<RawToolResult>;
  summarize(executionId: string): CandidateSupplyAttemptSummary | undefined;
  dispose(executionId: string): void;
}

interface ToolRequest {
  readonly executionId: string;
  readonly input: unknown;
  readonly signal: AbortSignal;
}

/** Creates the transient Tool owner shared by Agent Executions and Context. */
export function createCandidateSupplyAttempts(options: {
  readonly observability?: Observability;
} = {}): CandidateSupplyAttempts {
  const attempts = new Map<string, CandidateSupplyAttempt>();

  return {
    start(input) {
      if (attempts.has(input.executionId)) {
        throw new Error(`Candidate Supply attempt already exists: ${input.executionId}.`);
      }
      attempts.set(input.executionId, {
        ...input,
        enabledSourceIds: new Set(input.enabledSourceIds),
        results: new Map(),
        sourceTails: new Map(),
        searchesSucceeded: 0,
        sourceFailureCount: 0,
        searchResultCount: 0,
        submissionCount: 0,
        addedCandidateCount: 0,
        addedInterestMatchCount: 0,
      });
    },
    ownsExecution: (executionId) => attempts.has(executionId),
    readContextState(executionId) {
      const attempt = attempts.get(executionId);
      return attempt
        ? {
            executionId,
            startedAt: attempt.startedAt,
            trigger: attempt.trigger,
            snapshot: attempt.repository.getCandidatePoolSnapshot(attempt.settings),
            enabledSourceIds: [...attempt.enabledSourceIds],
          }
        : undefined;
    },
    async searchContent(request) {
      const attempt = attempts.get(request.executionId);
      if (!attempt) return toolError('attempt_not_found', 'Candidate Supply attempt was not found.');
      if (request.signal.aborted) return toolError('tool_cancelled', 'Candidate search was cancelled.');
      const parsed = CandidateSupplySearchInputSchema.safeParse(request.input);
      if (!parsed.success) return toolError('invalid_search_request', 'Candidate search input is invalid.');
      const source = attempt.sourceRegistry.get(parsed.data.sourceId);
      if (!source || !attempt.enabledSourceIds.has(parsed.data.sourceId)) {
        return toolError('source_not_available', 'Source is not enabled for this Candidate Supply execution.');
      }
      let availability;
      try {
        availability = source.getAvailability();
      } catch {
        return toolError('source_not_available', 'Source availability could not be read.');
      }
      if (availability.state !== 'ready') {
        return toolError('source_not_available', `Source is not ready: ${availability.state}.`);
      }
      if (!source.descriptor.supportedModes.includes(parsed.data.mode)) {
        return toolError('source_mode_unsupported', 'Source does not support the requested search mode.');
      }
      return withSourceLock(attempt, source.descriptor.id, () => observeOperation(
        options.observability,
        'source.search',
        { executionId: request.executionId, sourceId: source.descriptor.id },
        async () => {
          const result = await source.search({
            query: parsed.data.query,
            mode: parsed.data.mode,
            limit: parsed.data.limit,
            signal: request.signal,
            onProviderResponse: (value) => recordContent(
              options.observability,
              'source.provider_response',
              value,
              { executionId: request.executionId, sourceId: source.descriptor.id },
            ),
          });
          recordContent(
            options.observability,
            'source.result',
            result,
            { executionId: request.executionId, sourceId: source.descriptor.id },
          );
          if (result.status === 'failed') {
            attempt.sourceFailureCount += 1;
            return toolError(result.failure.code, result.failure.message);
          }
          const results = result.items.flatMap((item) => {
            const validated = SourceContentSchema.safeParse(item);
            if (!validated.success) return [];
            const sourceResult: SourceResult = {
              resultId: `source-result:${randomUUID()}`,
              source,
              content: validated.data,
            };
            attempt.results.set(sourceResult.resultId, sourceResult);
            return [{ resultId: sourceResult.resultId, content: sourceResult.content }];
          });
          attempt.searchesSucceeded += 1;
          attempt.searchResultCount += results.length;
          return toolSuccess({
            status: 'success',
            results,
            pool: attempt.repository.getCandidatePoolSnapshot(attempt.settings),
          });
        },
      ));
    },
    async readSourceCandidate(request) {
      const attempt = attempts.get(request.executionId);
      if (!attempt) return toolError('attempt_not_found', 'Candidate Supply attempt was not found.');
      if (request.signal.aborted) return toolError('tool_cancelled', 'Candidate detail read was cancelled.');
      const resultId = recordString(request.input, 'resultId');
      const sourceResult = resultId ? attempt.results.get(resultId) : undefined;
      if (!resultId || !sourceResult) {
        return toolError('source_result_not_found', 'Source result is not part of this execution.');
      }
      if (!sourceResult.source.read) {
        return toolError('read_unavailable', 'Source cannot provide additional detail.');
      }
      return withSourceLock(attempt, sourceResult.source.descriptor.id, () => observeOperation(
        options.observability,
        'source.read',
        {
          executionId: request.executionId,
          sourceId: sourceResult.source.descriptor.id,
        },
        async () => {
          const read = await sourceResult.source.read!({
            ...(sourceResult.content.sourceContentId
              ? { sourceContentId: sourceResult.content.sourceContentId }
              : {}),
            url: sourceResult.content.canonicalUrl,
            signal: request.signal,
            onProviderResponse: (value) => recordContent(
              options.observability,
              'source.provider_response',
              value,
              {
                executionId: request.executionId,
                sourceId: sourceResult.source.descriptor.id,
              },
            ),
          });
          recordContent(options.observability, 'source.result', read, {
            executionId: request.executionId,
            sourceId: sourceResult.source.descriptor.id,
          });
          if (read.status === 'failed') {
            attempt.sourceFailureCount += 1;
            return toolError(read.failure.code, read.failure.message);
          }
          sourceResult.content = read.detail;
          return toolSuccess({
            status: 'success',
            result: { resultId, content: read.detail },
          });
        },
      ));
    },
    async submitCandidates(request) {
      const attempt = attempts.get(request.executionId);
      if (!attempt) return toolError('attempt_not_found', 'Candidate Supply attempt was not found.');
      if (request.signal.aborted) return toolError('tool_cancelled', 'Candidate submission was cancelled.');
      const parsed = CandidateSupplySubmitInputSchema.safeParse(request.input);
      if (!parsed.success) return toolError('invalid_submission', 'Candidate submission input is invalid.');
      const sourceResults = parsed.data.items.map((item) => ({
        item,
        result: attempt.results.get(item.resultId),
      }));
      if (sourceResults.some(({ result }) => !result)) {
        return toolError('source_result_not_found', 'Submission contains a result outside this execution.');
      }
      return observeOperation(
        options.observability,
        'candidate.submit',
        { executionId: request.executionId },
        async () => {
          const outcomes = [];
          let addedCandidateCount = 0;
          let addedInterestMatchCount = 0;
          for (const { item, result } of sourceResults) {
            if (!result) continue;
            const outcome = attempt.repository.submitCandidate({
              content: sourceContent(result.content),
              contentSummary: item.contentSummary,
              matches: item.matches,
              settings: attempt.settings,
            });
            outcomes.push({ resultId: item.resultId, outcome });
            addedCandidateCount += outcome.addedCandidateCount;
            addedInterestMatchCount += outcome.addedInterestMatchCount;
          }
          attempt.submissionCount += 1;
          attempt.addedCandidateCount += addedCandidateCount;
          attempt.addedInterestMatchCount += addedInterestMatchCount;
          return toolSuccess({
            status: 'submitted',
            outcomes,
            addedCandidateCount,
            addedInterestMatchCount,
            pool: attempt.repository.getCandidatePoolSnapshot(attempt.settings),
          });
        },
      );
    },
    summarize(executionId) {
      const attempt = attempts.get(executionId);
      return attempt ? summary(attempt) : undefined;
    },
    dispose: (executionId) => {
      attempts.delete(executionId);
    },
  };
}

function summary(attempt: CandidateSupplyAttempt): CandidateSupplyAttemptSummary {
  return {
    searchesSucceeded: attempt.searchesSucceeded,
    sourceFailureCount: attempt.sourceFailureCount,
    searchResultCount: attempt.searchResultCount,
    submissionCount: attempt.submissionCount,
    addedCandidateCount: attempt.addedCandidateCount,
    addedInterestMatchCount: attempt.addedInterestMatchCount,
  };
}

function sourceContent(content: SourceContent | SourceContentDetail): SourceContentDetail {
  return SourceContentDetailSchema.parse({
    sourceId: content.sourceId,
    sourceName: content.sourceName,
    ...(content.sourceContentId ? { sourceContentId: content.sourceContentId } : {}),
    canonicalUrl: content.canonicalUrl,
    contentType: content.contentType,
    title: content.title,
    ...(content.author ? { author: content.author } : {}),
    ...(content.publishedAt ? { publishedAt: content.publishedAt } : {}),
    ...(content.description ? { description: content.description } : {}),
    ...(content.coverUrl ? { coverUrl: content.coverUrl } : {}),
    ...(content.engagement ? { engagement: content.engagement } : {}),
    ...('contentText' in content && content.contentText
      ? { contentText: content.contentText }
      : {}),
  });
}

async function observeOperation(
  observability: Observability | undefined,
  name: 'source.search' | 'source.read' | 'candidate.submit',
  correlation: TraceCorrelation,
  operation: () => Promise<RawToolResult>,
): Promise<RawToolResult> {
  let pending: Promise<RawToolResult> | undefined;
  const runOnce = () => (pending ??= operation());
  if (!observability) return runOnce();
  try {
    return await observability.withSpan({
      name,
      correlation,
      classifyResult,
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function classifyResult(result: RawToolResult): OperationCompletion {
  if (!result.isError) return { outcome: { status: 'ok' } };
  return {
    outcome: {
      status: 'error',
      code: recordString(result.content, 'code') ?? 'candidate_supply_tool_failed',
      message: recordString(result.content, 'message') ?? 'Candidate Supply Tool failed.',
    },
  };
}

function recordContent(
  observability: Observability | undefined,
  kind: 'source.provider_response' | 'source.result',
  value: unknown,
  correlation: TraceCorrelation,
): void {
  try {
    observability?.recordContent({ kind, value, correlation });
  } catch {
    // Diagnostic capture cannot alter Source or Candidate business behavior.
  }
}

async function withSourceLock<T>(
  attempt: CandidateSupplyAttempt,
  sourceId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = attempt.sourceTails.get(sourceId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  attempt.sourceTails.set(sourceId, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (attempt.sourceTails.get(sourceId) === tail) attempt.sourceTails.delete(sourceId);
  }
}

function toolSuccess(content: unknown): RawToolResult {
  return { outputKind: 'json', content };
}

function toolError(code: string, message: string): RawToolResult {
  return {
    outputKind: 'json',
    content: { status: 'failed', code, message },
    isError: true,
  };
}

function recordString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}
