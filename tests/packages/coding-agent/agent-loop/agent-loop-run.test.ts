// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  AgentLoop,
  type AgentLoopOptions,
} from '@megumi/coding-agent/agent-loop';
import type { BuildModelCallInputInput, BuildModelCallInputResult } from '@megumi/coding-agent/agent-loop/model-input/model-call-input-builder';
import type { SessionContextInput } from '@megumi/shared/session';
import type { ModelInputContext, ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import { createRuntimeEvent } from '@megumi/shared/runtime';

describe('AgentLoop', () => {
  it('builds initial input and streams through agent runtime', async () => {
    const order: string[] = [];
    const buildInputs: BuildModelCallInputInput[] = [];
    const modelRequests: ModelStepRuntimeRequest[] = [];
    const options = createOptions({
      async buildModelCallInput(input) {
        order.push(`build:${input.contextKind}`);
        buildInputs.push(input);
        return successfulModelStepInputBuild(input);
      },
      async *streamModelCall({ request }: { request: ModelStepRuntimeRequest }): AsyncIterable<RuntimeEvent> {
        order.push('model');
        modelRequests.push(request);
        yield assistantOutputCompleted(request, 1, 'Hello');
        yield modelStepCompleted(request, 2);
      },
    }, order);
    const loop = new AgentLoop(options);

    const events = await collect(loop.run({
      requestId: 'request-1',
      session,
      run,
      step,
      userMessage,
      providerId: 'openai',
      modelId: 'gpt-test',
      permissionMode: 'default',
      inputPreprocessing: {
        originalText: 'Hello',
        effectiveUserText: 'Hello',
        entries: [],
        diagnostics: [],
      },
      createdAt: '2026-06-21T00:00:00.000Z',
    }));

    expect(order).toEqual(['memory', 'append:run.started', 'session-context', 'build:initial', 'model']);
    expect(buildInputs.map((input) => input.contextKind)).toEqual(['initial']);
    expect(modelRequests).toHaveLength(1);
    expect(modelRequests[0]?.inputContext.contextId).toBe('context:initial');
    expect(events.map((event) => event.eventType)).toEqual([
      'run.started',
      'assistant.output.completed',
      'model.step.completed',
    ]);
  });

  it('adds ParsedInput command facts to initial model input builds', async () => {
    const buildInputs: BuildModelCallInputInput[] = [];
    const loop = new AgentLoop(createOptions({
      async buildModelCallInput(input) {
        buildInputs.push(input);
        return successfulModelStepInputBuild(input);
      },
    }));

    await collect(loop.run({
      requestId: 'request-1',
      session,
      run,
      step,
      userMessage,
      providerId: 'openai',
      modelId: 'gpt-test',
      permissionMode: 'plan',
      inputPreprocessing: {
        originalText: '/review src',
        effectiveUserText: '/review src',
        entries: [],
        diagnostics: [],
      },
      parsedInput: {
        id: 'parsed-input:1',
        rawInputId: 'raw-input:1',
        source: { kind: 'composer' },
        rawKind: 'slash_command',
        kind: 'user_input',
        text: '/review src',
        attachments: [],
        references: [],
        facts: [{
          kind: 'command',
          name: 'review',
          source: { kind: 'built_in' },
          arguments_input: 'src',
          raw_input: '/review src',
        }],
        createdAt: '2026-06-21T00:00:00.000Z',
      },
      createdAt: '2026-06-21T00:00:00.000Z',
    }));

    expect(buildInputs).toHaveLength(1);
    for (const input of buildInputs) {
      expect(input.runInputFacts?.effectiveUserText).toBe('/review src');
      expect(input.runInputFacts?.facts).toEqual([{
        kind: 'command',
        name: 'review',
        source: { kind: 'built_in' },
        arguments_input: 'src',
        raw_input: '/review src',
      }]);
    }
  });

  it('does not append run.started twice when the initial model input build throws', async () => {
    const order: string[] = [];
    const buildInputs: BuildModelCallInputInput[] = [];
    const loop = new AgentLoop(createOptions({
      async buildModelCallInput(input) {
        buildInputs.push(input);
        if (input.contextKind === 'initial') {
          throw new Error('initial build exploded');
        }
        return successfulModelStepInputBuild(input);
      },
    }, order));

    const events = await collect(loop.run({
      requestId: 'request-1',
      session,
      run,
      step,
      userMessage,
      providerId: 'openai',
      modelId: 'gpt-test',
      permissionMode: 'default',
      inputPreprocessing: {
        originalText: 'Hello',
        effectiveUserText: 'Hello',
        entries: [],
        diagnostics: [],
      },
      createdAt: '2026-06-21T00:00:00.000Z',
    }));

    expect(buildInputs.map((input) => input.contextKind)).toEqual(['initial']);
    expect(order.filter((entry) => entry === 'append:run.started')).toHaveLength(1);
    expect(events.map((event) => event.eventType)).toEqual([
      'run.started',
      'run.failed',
    ]);
  });
});

const session = {
  sessionId: 'session-1',
  title: 'Session',
  status: 'active',
  workspaceId: 'project-1',
  workspacePath: 'C:/repo',
  createdAt: '2026-06-21T00:00:00.000Z',
  updatedAt: '2026-06-21T00:00:00.000Z',
} as const;

const run = {
  runId: 'run-1',
  sessionId: 'session-1',
  triggerMessageId: 'message-user',
  mode: 'default',
  goal: 'Hello',
  status: 'running',
  createdAt: '2026-06-21T00:00:00.000Z',
  startedAt: '2026-06-21T00:00:00.000Z',
} as const;

const step = {
  stepId: 'step-1',
  runId: 'run-1',
  kind: 'model',
  status: 'running',
  title: 'Model response',
  startedAt: '2026-06-21T00:00:00.000Z',
} as const;

const userMessage = {
  messageId: 'message-user',
  sessionId: 'session-1',
  runId: 'run-1',
  role: 'user',
  content: 'Hello',
  status: 'completed',
  createdAt: '2026-06-21T00:00:00.000Z',
  completedAt: '2026-06-21T00:00:00.000Z',
} as const;

function createOptions(
  overrides: Partial<{
    buildModelCallInput(input: BuildModelCallInputInput): Promise<BuildModelCallInputResult>;
    streamModelCall(input: { request: ModelStepRuntimeRequest }): AsyncIterable<RuntimeEvent>;
  }> = {},
  order: string[] = [],
): AgentLoopOptions {
  return {
    clock: { now: () => '2026-06-21T00:00:01.000Z' },
    ids: {
      eventId: () => `event-${Math.random()}`,
    },
    eventPort: {
      append(event, _requestId, _runtimeContext) {
        order.push(`append:${event.eventType}`);
        return event;
      },
    },
    statePort: {
      getRunStatus(_runId) { return undefined; },
    },
    failurePort: {
      async *failBeforeModelCall(failureInput) {
        order.push('failure');
        yield createRuntimeEvent({
          eventId: `event-failure-${Math.random()}`,
          eventType: 'run.failed',
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 1,
          createdAt: '2026-06-21T00:00:01.000Z',
          source: 'core',
          visibility: 'user',
          persist: 'required',
          payload: { error: failureInput.error },
        });
      },
    },
    contextService: {
      createBaselineContext() {
        return {
          contextBudgetPolicy: {
            modelContextWindow: 8192,
            reservedOutputTokens: 1024,
            keepRecentTokens: 7168,
          },
        };
      },
    },
    sessionContextInputService: {
      buildSessionContextInput(): SessionContextInput {
        order.push('session-context');
        return { historyEntries: [], runtimeFacts: [], maxHistoryEntries: 24 };
      },
    },
    sourceOverrideProvider: {
      resolveModelInputSourceOverrides() {
        return {};
      },
    },
    memoryRecallService: {
      async recallForNewUserInput() {
        order.push('memory');
        return {};
      },
    },
    modelCallInputBuildService: {
      buildModelCallInput: overrides.buildModelCallInput ?? (async (input) => successfulModelStepInputBuild(input)),
    },
    toolSetService: {
      prepareToolSet() {
        return { events: [] };
      },
    },
    modelCallPort: {
      streamModelCall: overrides.streamModelCall ?? (async function* ({ request }) {
        order.push('model');
        yield assistantOutputCompleted(request, 1, 'Hello');
        yield modelStepCompleted(request, 2);
      }),
    },
    eventRecorder: {
      async *recordModelCallEvents(input) {
        for await (const event of input.modelEvents) {
          yield event;
        }
      },
    },
  };
}

function successfulModelStepInputBuild(input: BuildModelCallInputInput): BuildModelCallInputResult {
  return {
    buildRequest: {} as never,
    inputContext: {
      contextId: `context:${input.contextKind}`,
      sessionId: input.sessionId,
      runId: input.runId,
      stepId: input.stepId,
      builtAt: input.builtAt,
      parts: [],
      budget: {
        modelContextWindow: 8192,
        reservedOutputTokens: 1024,
        availableInputTokens: 7168,
        keepRecentTokens: 7168,
        inputTokenEstimate: 0,
        partBudgets: [],
      },
      trace: {
        buildReason: 'initial_model_step',
        selectedSources: [],
        excludedSources: [],
      },
    },
    toolDefinitions: input.toolDefinitions ?? [],
    instructionSources: [],
    availableCapabilitySummary: 'Available tools: none.',
  };
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const event of events) {
    output.push(event);
  }
  return output;
}

function assistantOutputCompleted(request: ModelStepRuntimeRequest, sequence: number, content: string): RuntimeEvent {
  return createRuntimeEvent({
    eventId: `event-assistant-${sequence}`,
    eventType: 'assistant.output.completed',
    runId: request.runId,
    sessionId: request.sessionId,
    stepId: request.stepId,
    requestId: request.requestId,
    sequence,
    createdAt: request.createdAt,
    source: 'provider',
    visibility: 'user',
    persist: 'required',
    payload: { content },
  });
}

function modelStepCompleted(request: ModelStepRuntimeRequest, sequence: number): RuntimeEvent {
  return createRuntimeEvent({
    eventId: `event-model-completed-${sequence}`,
    eventType: 'model.step.completed',
    runId: request.runId,
    sessionId: request.sessionId,
    stepId: request.stepId,
    requestId: request.requestId,
    sequence,
    createdAt: request.createdAt,
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: { modelStepId: request.modelStepId ?? request.stepId, finishReason: 'stop' },
  });
}
