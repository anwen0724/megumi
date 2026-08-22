/* Verifies the Context adapter: one Router scope per turn, overflow reuse, idempotent release. */
import { describe, expect, it, vi } from 'vitest';
import type { AgentContextProvider } from '@megumi/agent';
import type { ContextCapabilities } from '@megumi/context';
import type { ModelCallToolBinding, ToolExecutionBinding } from '@megumi/tools';
import {
  createContextAdapter,
  releaseActiveScope,
  type ContextAdapterDependencies,
  type ContextAdapterRuntime,
} from '../../../packages/discovery-agent/src/execution/context-adapter';
import type { ExecutionObserver } from '../../../packages/discovery-agent/src/execution/execution-observer';
import type { ExecutionMetadata } from '../../../packages/discovery-agent/src/execution/execution-registry';
import { executionMetadata, model } from './execution-test-fixtures';

const metadata = executionMetadata();

function createAdapter(overrides: {
  readonly build?: ContextCapabilities['build'];
  readonly compact?: ContextCapabilities['compact'];
  readonly release?: (request: { readonly modelCallId: string }) => void;
} = {}): {
  adapter: AgentContextProvider;
  runtime: ContextAdapterRuntime;
  released: string[];
} {
  const released: string[] = [];
  const observer: ExecutionObserver = {
    start: () => undefined,
    end: () => undefined,
    startSpan: () => undefined,
    endSpan: () => undefined,
    recordLog: () => undefined,
    recordMeasurement: () => undefined,
  };
  const dependencies: ContextAdapterDependencies = {
    metadata,
    userInput: {
      displayContent: [{ type: 'text', text: 'hello' }],
      modelContent: [{ type: 'text', text: 'hello' }],
      attachments: [],
    },
    context: {
      build: overrides.build ?? (async (request) => ({
        status: 'ready',
        prompt: {
          systemPrompt: 'test',
          messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
          tools: [...request.modelCallContext.tools],
        },
      })),
      compact: overrides.compact ?? (async () => ({
        status: 'nothing_to_compact' as const,
        reason: 'no_historical_messages',
      })),
    } as ContextCapabilities,
    toolExecution: {
      executionId: metadata.executionId,
      prepareModelCall: ({ modelCallId }) => ({
        status: 'prepared' as const,
        binding: {
          modelCallId,
          definitions: [],
          routeToolCall: () => ({ status: 'failed', error: { code: 'unknown_tool', message: 'unused' } }),
          executeToolInvocation: async () => { throw new Error('unused'); },
          close: () => (overrides.release ?? ((request) => { released.push(request.modelCallId); }))({ modelCallId }),
        } satisfies ModelCallToolBinding,
      }),
      close: () => undefined,
    } satisfies ToolExecutionBinding,
    ids: { createModelCallId: () => 'model-call:1' },
    observer,
    createAgentTool: (definition) => ({
      ...definition,
      parameters: definition.parameters as never,
      execute: async () => ({
        status: 'completed',
        result: { content: [{ type: 'text', text: 'done' }], isError: false },
      }),
    }),
  };
  const runtime: ContextAdapterRuntime = {};
  return { adapter: createContextAdapter(dependencies, runtime), runtime, released };
}

describe('Context Adapter', () => {
  it('resolves one Router scope per prepare and releases it on the next prepare', async () => {
    const released: string[] = [];
    let modelCalls = 0;
    const { adapter, runtime } = createAdapter({
      release: (request) => { released.push(request.modelCallId); },
    });
    void modelCalls;

    const first = await adapter.prepare({ model, context: { systemPrompt: '', messages: [], tools: [] }, signal: new AbortController().signal });
    expect(first.status).toBe('ready');
    expect(runtime.activeScope).toMatchObject({ modelCallId: 'model-call:1', released: false });

    const second = await adapter.prepare({ model, context: { systemPrompt: '', messages: [], tools: [] }, signal: new AbortController().signal });
    expect(second.status).toBe('ready');
    expect(released).toEqual(['model-call:1']);
    expect(runtime.activeScope?.released).toBe(false);
  });

  it('releases the scope when Context build fails', async () => {
    const released: string[] = [];
    const { adapter, runtime } = createAdapter({
      build: async () => ({
        status: 'failed',
        failure: {
          code: 'context_build_failed',
          message: 'Context unavailable.',
          retryable: false,
          cause: { owner: 'context', code: 'source_unavailable' },
        },
      }),
      release: (request) => { released.push(request.modelCallId); },
    });

    const result = await adapter.prepare({ model, context: { systemPrompt: '', messages: [], tools: [] }, signal: new AbortController().signal });
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'context_failed', cause: { owner: 'context', code: 'source_unavailable' } },
    });
    expect(released).toEqual(['model-call:1']);
    expect(runtime.activeScope).toBeUndefined();
  });

  it('returns cancelled when the signal aborts during build', async () => {
    const controller = new AbortController();
    const { adapter } = createAdapter({
      build: async () => {
        controller.abort();
        return {
          status: 'failed',
          failure: { code: 'cancelled', message: 'cancelled', retryable: false },
        };
      },
    });
    const result = await adapter.prepare({ model, context: { systemPrompt: '', messages: [], tools: [] }, signal: controller.signal });
    expect(result.status).toBe('cancelled');
  });

  it('rebuilds overflow Context on the same scope through recoverOverflow', async () => {
    const compacts: unknown[] = [];
    const { adapter } = createAdapter({
      compact: (async (request) => {
        compacts.push(structuredClone(request));
        return { status: 'compacted', compactionId: 'compaction:1', usageBefore: { tokens: 10, usageTokens: 0, trailingTokens: 10, lastUsageIndex: null }, usageAfter: { tokens: 1, usageTokens: 0, trailingTokens: 1, lastUsageIndex: null } };
      }) as ContextCapabilities['compact'],
    });
    await adapter.prepare({ model, context: { systemPrompt: '', messages: [], tools: [] }, signal: new AbortController().signal });

    const recovered = await adapter.recoverOverflow!({ model, context: { systemPrompt: '', messages: [], tools: [] }, signal: new AbortController().signal, attempt: 1 });
    expect(recovered.status).toBe('ready');
    expect(compacts).toHaveLength(1);
    expect(compacts[0]).toMatchObject({ sessionId: 'session:1', workspaceId: 'workspace:1', trigger: 'overflow', tools: [] });
  });

  it('fails recoverOverflow without an active scope', async () => {
    const { adapter } = createAdapter();
    const result = await adapter.recoverOverflow!({ model, context: { systemPrompt: '', messages: [], tools: [] }, signal: new AbortController().signal, attempt: 1 });
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'context_failed', cause: { owner: 'discovery-agent', code: 'model_call_scope_missing' } },
    });
  });

  it('releases the scope idempotently', () => {
    const released: string[] = [];
    const dependencies = {
      metadata,
      userInput: { displayContent: [], modelContent: [], attachments: [] },
      context: {} as ContextCapabilities,
      toolExecution: {} as ToolExecutionBinding,
      ids: { createModelCallId: () => 'model-call:1' },
      observer: { recordLog: () => undefined } as unknown as ExecutionObserver,
      createAgentTool: () => ({} as never),
    } as ContextAdapterDependencies;
    const runtime: ContextAdapterRuntime = {
      activeScope: {
        modelCallId: 'model-call:1', definitions: [], tools: [], released: false,
        binding: {
          modelCallId: 'model-call:1', definitions: [],
          routeToolCall: () => ({ status: 'failed', error: { code: 'unknown_tool', message: 'unused' } }),
          executeToolInvocation: async () => { throw new Error('unused'); },
          close: () => { released.push('model-call:1'); },
        },
      },
    };
    releaseActiveScope(dependencies, runtime);
    releaseActiveScope(dependencies, runtime);
    expect(released).toEqual(['model-call:1']);
    expect(runtime.activeScope).toBeUndefined();
  });
});
