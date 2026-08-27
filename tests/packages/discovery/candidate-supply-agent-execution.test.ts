/* Drives the real Candidate Supply Agent Tool Loop against deterministic replay Sources. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type Models,
} from '@megumi/ai';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import {
  createCandidateSupplyAttempts,
  createCandidateSupplyRuntime,
  createDiscoveryRepository,
  createSourceRegistry,
  type DiscoverySource,
} from '@megumi/discovery';
import { createAgentExecutions, launchAgentExecution } from '@megumi/execution';
import { createEventBus } from '@megumi/events';
import { createTools } from '@megumi/tools';

const now = '2026-08-27T00:00:00.000Z';
const model = {
  id: 'candidate-model', name: 'Candidate Model', api: 'test-api', provider: 'test-provider',
  baseUrl: 'https://example.invalid', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 16_384, maxTokens: 2_048,
} as Model<Api>;

describe('Candidate Supply Agent execution', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
  });
  afterEach(() => database.close());

  it('searches multiple Sources, tolerates one failure, and commits one typed admission batch', async () => {
    const repository = createDiscoveryRepository({ database });
    repository.changeInterest({
      action: 'create', interestId: 'interest:agent', description: 'Agent architecture', now,
    });
    const sources = [
      source('community', async () => ({
        status: 'success',
        items: [
          content('community', 'admit', 'Practical Agent architecture'),
          content('community', 'stale', 'Outdated Agent architecture'),
        ],
      })),
      source('unstable', async () => ({
        status: 'failed',
        failure: { code: 'network_error', message: 'Temporary failure.', retryable: true },
      })),
    ];
    let modelCall = 0;
    const modelContexts: Context[] = [];
    const models = {
      streamSimple: vi.fn((_model: Model<Api>, context: Context) => {
        modelContexts.push(context);
        modelCall += 1;
        if (modelCall === 1) {
          return toolsStream([
            {
              id: 'search:community', name: 'search_content',
              arguments: {
                sourceId: 'community', query: 'Agent architecture', mode: 'relevance', limit: 5,
                targetInterestIds: ['interest:agent'],
              },
            },
            {
              id: 'search:unstable', name: 'search_content',
              arguments: {
                sourceId: 'unstable', query: 'Agent architecture', mode: 'relevance', limit: 5,
                targetInterestIds: ['interest:agent'],
              },
            },
          ]);
        }
        if (modelCall === 2) {
          const candidateIds = admissionCandidateIds(context);
          expect(candidateIds).toHaveLength(2);
          return toolsStream([{
            id: 'admission:1', name: 'commit_candidate_admission',
            arguments: { decisions: [
              {
                candidateId: candidateIds[0], decision: 'admit', relevance: 'direct',
                matchedInterestIds: ['interest:agent'], contentValue: 'substantive', novelty: 'novel',
                temporalValidity: 'valid', negativeConstraint: 'clear', reason: 'Useful and current.',
                interestRevisions: [{ interestId: 'interest:agent', revision: 1 }],
                preferenceRevisions: [], preferenceAlignment: [],
              },
              {
                candidateId: candidateIds[1], decision: 'reject', relevance: 'direct',
                matchedInterestIds: ['interest:agent'], contentValue: 'substantive', novelty: 'novel',
                temporalValidity: 'stale', negativeConstraint: 'clear', reasonCode: 'stale',
                reason: 'The described implementation is obsolete.',
                interestRevisions: [{ interestId: 'interest:agent', revision: 1 }],
                preferenceRevisions: [], preferenceAlignment: [],
              },
            ] },
          }]);
        }
        return textStream('Candidate Supply complete.');
      }),
    } as unknown as Models;
    const attempts = createCandidateSupplyAttempts();
    const tools = candidateSupplyTools(attempts);
    let executionNumber = 0;
    let modelCallNumber = 0;
    let toolNumber = 0;
    const executionOptions = {
      ids: {
        createExecutionId: () => `execution:${++executionNumber}`,
        createSessionMessageId: () => 'message:unused',
        createModelCallId: () => `model-call:${++modelCallNumber}`,
        createToolExecutionId: () => `tool:${++toolNumber}`,
        createApprovalId: () => 'approval:unused',
      },
      clock: { now: () => now },
      terminalRetentionMs: 60_000,
      events: createEventBus(),
      models,
      context: {
        build: async (request: Parameters<import('@megumi/context').ContextCapabilities['build']>[0]) => ({
          status: 'ready' as const,
          prompt: {
            systemPrompt: JSON.stringify(request.modelCallContext.run),
            messages: [...request.currentMessages],
            tools: [...request.modelCallContext.tools],
          },
        }),
        compact: async () => ({
          status: 'nothing_to_compact' as const, reason: 'no_historical_messages' as const,
        }),
      },
      tools,
      permissions: {} as never,
      session: {} as never,
      policy: {
        maxModelCallsPerExecution: 8, maxToolRoundsPerExecution: 6,
        maxToolCallsPerModelCall: 4, maxToolCallsPerExecution: 12,
        maxConcurrentToolExecutions: 2, modelCallTimeoutMs: 1_000,
        toolExecutionTimeoutMs: 1_000, maxModelCallAttempts: 1,
        modelRetryDelayMs: 0, maxContextOverflowRecoveries: 1,
        providerRequestMaxRetries: 0, providerRequestMaxRetryDelayMs: 0,
      },
    };
    const executions = createAgentExecutions({
      ids: executionOptions.ids,
      clock: executionOptions.clock,
      terminalRetentionMs: executionOptions.terminalRetentionMs,
      events: executionOptions.events,
      launch: (input) => launchAgentExecution(input, executionOptions),
    });
    const runtime = createCandidateSupplyRuntime({
      repository,
      attempts,
      sourceRegistry: createSourceRegistry(sources),
      settings: {
        read: () => ({
          conversationRecognitionEnabled: false, dailyGenerationTime: '08:00',
          dailyTargetCount: 1, enabledSources: sources.map(({ descriptor }) => descriptor.id),
        }),
        write: () => undefined,
      },
      startExecution: (request) => executions.start(request),
      resolveModel: async () => ({ status: 'ok', model }),
      now: () => now,
      timers: { set: () => 'timer', clear: () => undefined },
    });

    await runtime.start();
    await vi.waitFor(() => expect(modelContexts).toHaveLength(3));
    await vi.waitFor(() => expect(candidateStatuses(database)).toEqual(['available', 'rejected']));

    expect(queryStatuses(database)).toEqual(['failed', 'succeeded']);
    expect(assessmentDecisions(database)).toEqual(['admit', 'reject']);
    expect(modelContexts[1]!.messages.filter(({ role }) => role === 'toolResult')).toHaveLength(2);
    await runtime.shutdown();
    await executions.shutdown({ timeoutMs: 1_000 });
  });
});

function candidateSupplyTools(attempts: ReturnType<typeof createCandidateSupplyAttempts>) {
  return createTools({
    settings: {
      resolveWebSearch: () => ({ status: 'failed' }),
      readWebSearchApiKey: () => ({ status: 'missing' }),
    },
    workspaces: { getWorkspace: () => { throw new Error('Candidate Supply has no Workspace.'); } },
    workspaceChanges: { trackToolExecution: ({ execute }) => execute() },
    sandbox: {
      capabilities: () => ({
        platform: 'win32', workspaceEffectObservation: true, fileReadBoundary: true,
        fileWriteBoundary: true, environmentIsolation: true, networkIsolation: true,
        processTreeTermination: true, timeLimit: true, outputLimit: true,
        processCountLimit: true, cpuLimit: false, memoryLimit: false,
      }),
      open: async () => ({ status: 'unavailable', reason: 'Candidate Supply has no Sandbox.' }),
    },
    executionPolicy: { maxExecutionTimeMs: 1_000, maxOutputBytes: 20_000, maxProcessCount: 4 },
    candidateSupplyTools: attempts,
  });
}

function source(id: string, search: DiscoverySource['search']): DiscoverySource {
  return {
    descriptor: {
      id, name: id, access: 'public_http', supportedModes: ['relevance'], supportsRead: false,
    },
    getAvailability: () => ({ state: 'ready' }),
    search,
  };
}

function content(sourceId: string, id: string, title: string) {
  return {
    sourceId, sourceName: sourceId, sourceContentId: id,
    canonicalUrl: `https://example.com/${sourceId}/${id}`, contentType: 'article' as const,
    title, description: `${title} with concrete implementation details.`,
  };
}

function admissionCandidateIds(context: Context): string[] {
  return context.messages.flatMap((message) => {
    if (message.role !== 'toolResult' || message.toolName !== 'search_content' || message.isError) return [];
    const text = message.content.find((block) => block.type === 'text')?.text;
    if (!text) return [];
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || !Array.isArray(value.admissionBatch)) return [];
    return value.admissionBatch.flatMap((item) => {
      if (!isRecord(item) || !isRecord(item.candidate)) return [];
      return typeof item.candidate.candidateId === 'string' ? [item.candidate.candidateId] : [];
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toolsStream(calls: Array<{ id: string; name: string; arguments: unknown }>) {
  return completedStream(assistant(calls.map((call) => ({
    type: 'toolCall' as const, id: call.id, name: call.name,
    arguments: call.arguments as Record<string, unknown>,
  })), 'toolUse'));
}

function textStream(text: string) {
  return completedStream(assistant([{ type: 'text', text }], 'stop'));
}

function completedStream(message: AssistantMessage): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  stream.push({ type: 'start', partial: { ...message, content: [] } });
  for (const [contentIndex, block] of message.content.entries()) {
    if (block.type === 'toolCall') {
      stream.push({ type: 'toolcall_start', contentIndex, partial: message });
      stream.push({ type: 'toolcall_end', contentIndex, toolCall: block, partial: message });
    } else if (block.type === 'text') {
      stream.push({ type: 'text_start', contentIndex, partial: message });
      stream.push({ type: 'text_delta', contentIndex, delta: block.text, partial: message });
      stream.push({ type: 'text_end', contentIndex, content: block.text, partial: message });
    }
  }
  stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
  stream.end();
  return stream;
}

function assistant(content: AssistantMessage['content'], stopReason: 'stop' | 'toolUse'): AssistantMessage {
  return {
    role: 'assistant', content, api: model.api, provider: model.provider,
    model: model.id, stopReason, timestamp: Date.parse(now),
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function candidateStatuses(database: DatabaseConnection): string[] {
  return database.prepare<{ status: string }>({
    sql: 'SELECT status FROM discovery_candidates ORDER BY status',
  }).all().map(({ status }) => status);
}

function queryStatuses(database: DatabaseConnection): string[] {
  return database.prepare<{ status: string }>({
    sql: 'SELECT status FROM discovery_candidate_queries ORDER BY status',
  }).all().map(({ status }) => status);
}

function assessmentDecisions(database: DatabaseConnection): string[] {
  return database.prepare<{ decision: string }>({
    sql: 'SELECT decision FROM discovery_candidate_assessments ORDER BY decision',
  }).all().map(({ decision }) => decision);
}
