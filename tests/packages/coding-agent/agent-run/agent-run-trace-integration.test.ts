import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAgentRunTraceFileLogger,
  createAgentRunService,
  type AgentRunTraceRecordInput,
  type CreateAgentRunServiceOptions,
  type ModelCallEvent,
} from '@megumi/coding-agent/agent-run';
import {
  collectEvents,
  createMessageFlowDependencies,
} from './agent-run-test-helpers';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('Agent Run trace integration', () => {
  it('records the no-tool run lifecycle without changing the run result', async () => {
    const records: AgentRunTraceRecordInput[] = [];
    const deps = createMessageFlowDependencies();
    const service = createAgentRunService({
      ...deps,
      trace_logger: { record: (record: AgentRunTraceRecordInput) => records.push(record) },
    } as unknown as CreateAgentRunServiceOptions);

    const result = await service.startRun({
      request_id: 'request-1',
      workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      user_input: { text: 'hello' },
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
      permission_mode: 'default',
    });

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;
    await collectEvents(result.events);

    expect(records.map((record) => record.event_type)).toEqual(expect.arrayContaining([
      'run.started',
      'trace.tools.created',
      'trace.prompt.built',
      'trace.model_call.request_payload',
      'trace.model_call.event_received',
      'run.completed',
    ]));
    expect(records.find((record) => record.event_type === 'trace.model_call.request_payload')?.payload)
      .toEqual(expect.objectContaining({
        owner_type: 'agent_run',
        preparation_id: 'preparation-1',
        provider_id: 'deepseek',
        model_id: 'deepseek-chat',
      }));
  });

  it('keeps prompt and provider secrets out of trace payloads and JSONL', async () => {
    const secrets = {
      user: 'CANARY_USER_SECRET',
      agents: 'CANARY_AGENTS_SECRET',
      memory: 'CANARY_MEMORY_SECRET',
      toolResult: 'CANARY_TOOL_RESULT_SECRET',
      apiKey: 'CANARY_API_KEY_SECRET',
    };
    const directory = await mkdtemp(join(tmpdir(), 'megumi-agent-run-trace-integration-'));
    tempDirectories.push(directory);
    const logPath = join(directory, 'agent-run-trace.jsonl');
    const fileLogger = createAgentRunTraceFileLogger({ log_file_path: logPath });
    const records: AgentRunTraceRecordInput[] = [];
    const deps = createMessageFlowDependencies();
    deps.settings_service.resolveProviderRuntimeConfig = vi.fn(() => ({
      status: 'ok' as const,
      config: {
        provider_id: 'deepseek',
        protocol: 'openai-compatible' as const,
        base_url: 'https://api.deepseek.com',
        model_id: 'deepseek-chat',
        api_key: secrets.apiKey,
        capabilities: {
          streaming: true,
          toolCalls: true,
          thinking: false,
          imageInput: true,
        },
      },
    }));
    Object.assign(deps.context_service, { prepareModelCall: vi.fn(async (request) => ({
      status: 'ready' as const,
      prepared: {
        preparationId: 'preparation-canary',
        prompt: {
          instructions: {
            system: [],
            agentInstructions: {
              sources: [{ sourceId: 'agents-1', sourcePath: 'AGENTS.md', content: secrets.agents }],
            },
            activatedSkills: [],
          },
          referenceContext: {
            skillCatalog: [],
            memoryRecall: {
              recallId: 'recall-1',
              items: [{ memoryId: 'memory-1', content: [{ type: 'text' as const, text: secrets.memory }] }],
            },
          },
          conversation: [
            { type: 'user_message' as const, content: [{ type: 'text' as const, text: secrets.user }] },
            {
              type: 'tool_result' as const,
              toolCallId: 'tool-call-secret',
              toolName: 'read_file',
              status: 'success' as const,
              content: [{ type: 'text' as const, text: secrets.toolResult }],
            },
          ],
          tools: request.tools,
        },
        usage: {
          usedTokens: 100,
          contextWindowTokens: 256_000,
          remainingTokens: 255_900,
          usedRatio: 100 / 256_000,
          compactionThresholdRatio: 0.8,
        },
        sourceRefs: [
          { sourceType: 'agent_instruction' as const, sourceId: 'agents-1' },
          { sourceType: 'memory' as const, sourceId: 'memory-1' },
          { sourceType: 'tool_result' as const, sourceId: 'tool-call-secret' },
        ],
      },
    })) });
    const service = createAgentRunService({
      ...deps,
      trace_logger: {
        record(record: AgentRunTraceRecordInput) {
          records.push(record);
          fileLogger.record(record);
        },
      },
    } as unknown as CreateAgentRunServiceOptions);

    const result = await service.startRun({
      request_id: 'request-secret',
      workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      user_input: { text: secrets.user },
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });
    expect(result.status).toBe('started');
    if (result.status !== 'started') return;
    await collectEvents(result.events);

    await waitFor(() => existsSync(logPath));
    await waitFor(async () => (await readFile(logPath, 'utf8')).includes('run.completed'));
    const serializedPayloads = JSON.stringify(records.map((record) => record.payload));
    const jsonl = await readFile(logPath, 'utf8');
    for (const secret of Object.values(secrets)) {
      expect(serializedPayloads).not.toContain(secret);
      expect(jsonl).not.toContain(secret);
    }
    expect(records.find((record) => record.event_type === 'trace.prompt.built')?.payload)
      .toEqual(expect.objectContaining({
        model_call_index: 1,
        preparation_id: 'preparation-canary',
        source_count: 3,
        source_type_counts: {
          agent_instruction: 1,
          memory: 1,
          tool_result: 1,
        },
        conversation_item_count: 2,
        conversation_item_type_counts: {
          user_message: 1,
          tool_result: 1,
        },
        tool_count: 1,
      }));
    expect(records.find((record) => record.event_type === 'trace.model_call.request_payload')?.payload)
      .not.toHaveProperty('model_config');
  });

  it('records tool calls, tool execution, runtime source continuation, and loop counters', async () => {
    const records: AgentRunTraceRecordInput[] = [];
    const deps = createMessageFlowDependencies();
    let modelCallIndex = 0;
    deps.model_call_service.modelCall = vi.fn(() => {
      modelCallIndex += 1;
      return {
        status: 'started' as const,
        model_call_id: `model-call-${modelCallIndex}`,
        events: modelCallIndex === 1
          ? asyncEvents<ModelCallEvent>([
              { type: 'started', model_call_id: 'model-call-1', created_at: '2026-01-01T00:00:00.000Z' },
              {
                type: 'tool_call',
                model_call_id: 'model-call-1',
                tool_call_id: 'tool-call-1',
                tool_name: 'read_file',
                input: { path: 'README.md' },
                arguments_text: '{"path":"README.md"}',
                created_at: '2026-01-01T00:00:00.000Z',
              },
            ])
          : asyncEvents<ModelCallEvent>([
              { type: 'started', model_call_id: 'model-call-2', created_at: '2026-01-01T00:00:00.000Z' },
              {
                type: 'completed',
                model_call_id: 'model-call-2',
                content: 'done',
                created_at: '2026-01-01T00:00:00.000Z',
              },
            ]),
      };
    });
    const service = createAgentRunService({
      ...deps,
      trace_logger: { record: (record: AgentRunTraceRecordInput) => records.push(record) },
    } as unknown as CreateAgentRunServiceOptions);

    const result = await service.startRun({
      request_id: 'request-1',
      workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      user_input: { text: 'read file' },
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;
    await collectEvents(result.events);

    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_type: 'trace.tool_call.requested',
        payload: expect.objectContaining({
          tool_calls: [expect.objectContaining({
            tool_call_id: 'tool-call-1',
            input: { path: 'README.md' },
          })],
        }),
      }),
      expect.objectContaining({ event_type: 'trace.tool_execution.request' }),
      expect.objectContaining({ event_type: 'trace.tool_execution.result' }),
      expect.objectContaining({ event_type: 'trace.model_call.messages_appended' }),
      expect.objectContaining({ event_type: 'trace.loop.counters' }),
    ]));
  });

  it('records failed runs when the loop limit is exceeded', async () => {
    const records: AgentRunTraceRecordInput[] = [];
    const deps = createMessageFlowDependencies({
      max_tool_rounds: 1,
      modelEvents: [
        { type: 'started', model_call_id: 'model-call-1', created_at: '2026-01-01T00:00:00.000Z' },
        {
          type: 'tool_call',
          model_call_id: 'model-call-1',
          tool_call_id: 'tool-call-1',
          tool_name: 'read_file',
          input: { path: 'README.md' },
          arguments_text: '{"path":"README.md"}',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const service = createAgentRunService({
      ...deps,
      trace_logger: { record: (record: AgentRunTraceRecordInput) => records.push(record) },
    } as unknown as CreateAgentRunServiceOptions);

    const result = await service.startRun({
      request_id: 'request-1',
      workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      user_input: { text: 'loop' },
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;
    await collectEvents(result.events);

    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_type: 'run.failed',
        payload: expect.objectContaining({
          failure: expect.objectContaining({
            code: 'loop_limit_exceeded',
          }),
        }),
      }),
    ]));
  });
});

async function* asyncEvents<T>(events: T[]): AsyncIterable<T> {
  yield* events;
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > 1000) throw new Error('Timed out waiting for trace logger output.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
