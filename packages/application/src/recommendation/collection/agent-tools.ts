/* Binds source search, content reading and candidate submission to one collection task. */
import type { AgentTool, RawToolResult } from '@megumi/agent';
import { Type } from '@megumi/ai';
import { randomUUID } from 'node:crypto';
import type { Observability, OperationCompletion, TraceCorrelation } from '../../observability/index';
import type { SettingsConfiguration } from '../../settings/settings-schema';
import type { CandidatePoolSettings, CandidatePoolSnapshot, CandidateSupplyRepository, CandidateSupplyTrigger } from '../candidates/candidate-pool';
import { CandidateSupplySearchInputSchema, CandidateSupplySubmitInputSchema, SourceContentDetailSchema, SourceContentSchema } from '../candidates/candidate-pool';
import type { DiscoverySource, SourceContent, SourceContentDetail, SourceRegistry } from '../sources/source-catalog';

interface SourceResult {
  readonly resultId: string;
  readonly source: DiscoverySource;
  content: SourceContent | SourceContentDetail;
}

interface CandidateSupplyAttempt {
  readonly startedAt: string;
  readonly trigger: CandidateSupplyTrigger;
  readonly repository: CandidateSupplyRepository;
  readonly sourceRegistry: SourceRegistry;
  readonly enabledSourceIds: ReadonlySet<string>;
  readonly settings: CandidatePoolSettings;
  readonly twitterBudget: SettingsConfiguration['discovery']['twitterBudget'];
  readonly now: () => string;
  readonly results: Map<string, SourceResult>;
  readonly sourceTails: Map<string, Promise<void>>;
  twitterSearchCalls: number;
  twitterResults: number;
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
  readonly startedAt: string;
  readonly trigger: CandidateSupplyTrigger;
  readonly snapshot: CandidatePoolSnapshot;
  readonly enabledSourceIds: readonly string[];
}

export interface CollectionTools {
  readonly tools: readonly AgentTool[];
  readContextState(): CandidateSupplyAttemptContext;
  summarize(): CandidateSupplyAttemptSummary;
}

export interface CreateCollectionToolsOptions {
  readonly startedAt: string;
  readonly trigger: CandidateSupplyTrigger;
  readonly repository: CandidateSupplyRepository;
  readonly sourceRegistry: SourceRegistry;
  readonly enabledSourceIds: readonly string[];
  readonly settings: CandidatePoolSettings;
  readonly twitterBudget: SettingsConfiguration['discovery']['twitterBudget'];
  readonly now: () => string;
  readonly observability?: Observability;
}

interface ToolRequest {
  readonly executionId: string;
  readonly input: unknown;
  readonly signal: AbortSignal;
}

/** Binds three complete tools and their transient search state to one collection task. */
export function createCollectionTools(options: CreateCollectionToolsOptions): CollectionTools {
  const attempt: CandidateSupplyAttempt = {
    ...options, enabledSourceIds: new Set(options.enabledSourceIds),
    results: new Map(), sourceTails: new Map(), twitterSearchCalls: 0, twitterResults: 0,
    searchesSucceeded: 0, sourceFailureCount: 0, searchResultCount: 0,
    submissionCount: 0, addedCandidateCount: 0, addedInterestMatchCount: 0,
  };
  const operations = {
    async searchContent(request: ToolRequest) {
      if (request.signal.aborted)
        return toolError('tool_cancelled', 'Candidate search was cancelled.');
      const parsed = CandidateSupplySearchInputSchema.safeParse(request.input);
      if (!parsed.success)
        return toolError('invalid_search_request', 'Candidate search input is invalid.');
      const source = attempt.sourceRegistry.get(parsed.data.sourceId);
      if (!source || !attempt.enabledSourceIds.has(parsed.data.sourceId)) {
        return toolError(
          'source_not_available',
          'Source is not enabled for this Candidate Supply execution.',
        );
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
        return toolError(
          'source_mode_unsupported',
          'Source does not support the requested search mode.',
        );
      }
      return withSourceLock(attempt, source.descriptor.id, () =>
        observeOperation(
          options.observability,
          'source.search',
          { executionId: request.executionId, sourceId: source.descriptor.id },
          async () => {
            let limit = parsed.data.limit;
            if (source.descriptor.id === 'twitter') {
              const budget = attempt.twitterBudget;
              if (
                attempt.twitterSearchCalls >= budget.maxSearchCalls ||
                attempt.twitterResults >= budget.maxResultsPerAttempt
              ) {
                return toolError(
                  'source_budget_exhausted',
                  'Twitter search budget has been reached for this attempt.',
                );
              }
              limit = Math.min(
                limit,
                budget.maxResultsPerSearch,
                budget.maxResultsPerAttempt - attempt.twitterResults,
              );
              attempt.twitterSearchCalls += 1;
            }
            const result = await source.search({
              query: parsed.data.query,
              mode: parsed.data.mode,
              limit,
              signal: request.signal,
              onProviderResponse: (value) =>
                recordContent(options.observability, 'source.provider_response', value, {
                  executionId: request.executionId,
                  sourceId: source.descriptor.id,
                }),
            });
            recordContent(options.observability, 'source.result', result, {
              executionId: request.executionId,
              sourceId: source.descriptor.id,
            });
            if (result.status === 'failed') {
              attempt.sourceFailureCount += 1;
              return toolError(result.failure.code, result.failure.message);
            }
            const results = result.items.slice(0, limit).flatMap((item) => {
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
            if (source.descriptor.id === 'twitter') attempt.twitterResults += results.length;
            attempt.searchesSucceeded += 1;
            attempt.searchResultCount += results.length;
            return toolSuccess({
              status: 'success',
              results,
              pool: attempt.repository.getCandidatePoolSnapshot(attempt.settings),
            });
          },
        ),
      );
    },
    async readSourceCandidate(request: ToolRequest) {
      if (request.signal.aborted)
        return toolError('tool_cancelled', 'Candidate detail read was cancelled.');
      const resultId = recordString(request.input, 'resultId');
      const sourceResult = resultId ? attempt.results.get(resultId) : undefined;
      if (!resultId || !sourceResult) {
        return toolError('source_result_not_found', 'Source result is not part of this execution.');
      }
      if (!sourceResult.source.read) {
        return toolError('read_unavailable', 'Source cannot provide additional detail.');
      }
      return withSourceLock(attempt, sourceResult.source.descriptor.id, () =>
        observeOperation(
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
              onProviderResponse: (value) =>
                recordContent(options.observability, 'source.provider_response', value, {
                  executionId: request.executionId,
                  sourceId: sourceResult.source.descriptor.id,
                }),
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
        ),
      );
    },
    async submitCandidates(request: ToolRequest) {
      if (request.signal.aborted)
        return toolError('tool_cancelled', 'Candidate submission was cancelled.');
      const parsed = CandidateSupplySubmitInputSchema.safeParse(request.input);
      if (!parsed.success)
        return toolError('invalid_submission', 'Candidate submission input is invalid.');
      const sourceResults = parsed.data.items.map((item) => ({
        item,
        result: attempt.results.get(item.resultId),
      }));
      if (sourceResults.some(({ result }) => !result)) {
        return toolError(
          'source_result_not_found',
          'Submission contains a result outside this execution.',
        );
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
  };
  return {
    tools: [
      {
        name: 'search_content',
        description: 'Search one enabled content source with one explicit query.',
        promptSnippet: 'Search an enabled content source using an explicit query, mode, and limit.',
        parameters: Type.Object({
          sourceId: Type.String(),
          query: Type.String(),
          mode: Type.Union([Type.Literal('relevance'), Type.Literal('recent')]),
          limit: Type.Integer({ minimum: 1, maximum: 20 }),
          targetInterestIds: Type.Array(Type.String()),
        }),
        operations: () => [],
        execute: (input, execution) => operations.searchContent({ input, executionId: execution.runId, signal: execution.signal }),
      } satisfies AgentTool,
      {
        name: 'read_source_candidate',
        description: 'Read optional detail for one Source result in the current Candidate Supply execution.',
        promptSnippet: 'Read additional Source detail only when the search metadata is insufficient.',
        parameters: Type.Object({ resultId: Type.String() }),
        operations: () => [],
        execute: (input, execution) => operations.readSourceCandidate({ input, executionId: execution.runId, signal: execution.signal }),
      } satisfies AgentTool,
      {
        name: 'submit_candidates',
        description: 'Submit Source results that are related to one or more active Interests.',
        promptSnippet: 'Submit related Source results with a grounded content summary and a concrete reason for each Interest match.',
        parameters: Type.Object({
          items: Type.Array(Type.Object({
            resultId: Type.String(),
            contentSummary: Type.String(),
            matches: Type.Array(Type.Object({
              interestId: Type.String(),
              relevance: Type.Union([
                Type.Literal('direct'),
                Type.Literal('adjacent'),
                Type.Literal('exploration'),
              ]),
              matchReason: Type.String(),
            }), { minItems: 1 }),
          }), { minItems: 1, maxItems: 50 }),
        }),
        operations: () => [],
        execute: (input, execution) => operations.submitCandidates({ input, executionId: execution.runId, signal: execution.signal }),
      } satisfies AgentTool
    ],
    readContextState: () => ({
      startedAt: attempt.startedAt, trigger: attempt.trigger,
      snapshot: attempt.repository.getCandidatePoolSnapshot(attempt.settings), enabledSourceIds: [...attempt.enabledSourceIds]
    }),
    summarize: () => summary(attempt),
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
    return await observability.withSpan(
      {
        name,
        correlation,
        classifyResult,
      },
      runOnce,
    );
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
