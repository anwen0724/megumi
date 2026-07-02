// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  AgentLoopInitialModelInputPreparationService,
  createAgentLoopInitialModelInputMemoryRecallService,
  type AgentLoopInitialModelInputMemoryRecallService,
  type BuildModelCallInputInput,
  type BuildModelCallInputResult,
  type SessionCompactionOrchestrationResult,
} from '@megumi/coding-agent/context';
import type { ModelInputContext } from '@megumi/shared/model';
import type { SessionContextInput } from '@megumi/shared/session';
import type { ToolDefinition } from '@megumi/coding-agent/tools';

describe('createAgentLoopInitialModelInputMemoryRecallService', () => {
  it('adapts memory recall runtime inputs for initial model input preparation', async () => {
    const recallForNewUserInput = vi.fn(async () => ({
      status: 'recalled',
      memoryRecallSources: [{
        sourceId: 'memory:1',
        text: 'Prefer small slices.',
        relevanceScore: 0.8,
        createdAt,
      }],
      memoryRecallSeed: {
        queryText: 'review this',
        metadata: { selectedCount: 1 },
      },
    }));

    const service = createAgentLoopInitialModelInputMemoryRecallService({
      memoryRecallService: { recallForNewUserInput },
      megumiHomePath: 'C:/megumi-home',
    });

    const result = await service?.recallForNewUserInput({
      projectId: 'project-1',
      projectRoot: 'C:/repo',
      effectiveCwd: 'C:/repo/packages',
      sessionId: 'session-1',
      runId: 'run-1',
      modelStepId: 'step-1',
      queryText: 'review this',
      providerId: 'openai',
      modelId: 'gpt-test',
      enabled: true,
      createdAt,
    });

    expect(recallForNewUserInput).toHaveBeenCalledWith(expect.objectContaining({
      homePath: 'C:/megumi-home',
      projectId: 'project-1',
      projectRoot: 'C:/repo',
      effectiveCwd: 'C:/repo/packages',
      sessionId: 'session-1',
      runId: 'run-1',
      modelStepId: 'step-1',
      queryText: 'review this',
      providerId: 'openai',
      modelId: 'gpt-test',
      enabled: true,
      createdAt,
    }));
    expect(result).toMatchObject({
      memoryRecallSources: [expect.objectContaining({ sourceId: 'memory:1' })],
      memoryRecallSeed: {
        queryText: 'review this',
        metadata: { selectedCount: 1 },
      },
    });
  });

  it('omits the adapter when memory runtime or home path is missing and degrades recall errors', async () => {
    expect(createAgentLoopInitialModelInputMemoryRecallService({})).toBeUndefined();
    expect(createAgentLoopInitialModelInputMemoryRecallService({
      memoryRecallService: { recallForNewUserInput: vi.fn() },
    })).toBeUndefined();

    const service = createAgentLoopInitialModelInputMemoryRecallService({
      memoryRecallService: {
        recallForNewUserInput: vi.fn(async () => {
          throw new Error('memory unavailable');
        }),
      },
      megumiHomePath: 'C:/megumi-home',
    });

    await expect(service?.recallForNewUserInput({
      sessionId: 'session-1',
      runId: 'run-1',
      modelStepId: 'step-1',
      queryText: 'review this',
      createdAt,
    })).resolves.toEqual({});
  });
});

describe('AgentLoopInitialModelInputPreparationService', () => {
  it('owns initial model input preparation across session context, memory recall, compaction probe, and initial input', async () => {
    const buildInputs: BuildModelCallInputInput[] = [];
    const sessionContextInput = vi.fn((): SessionContextInput => ({
      historyEntries: [],
      runtimeFacts: [],
      maxHistoryEntries: 24,
    }));
    let memoryRecallInput: Parameters<AgentLoopInitialModelInputMemoryRecallService['recallForNewUserInput']>[0]
      | undefined;
    const memoryRecall = vi.fn(async (
      input: Parameters<AgentLoopInitialModelInputMemoryRecallService['recallForNewUserInput']>[0],
    ) => {
      memoryRecallInput = input;
      return {
      memoryRecallSources: [{
        sourceId: 'memory:1',
        text: 'Use project conventions.',
        relevanceScore: 0.9,
        createdAt,
      }],
      memoryRecallSeed: {
        queryText: '/review src',
        metadata: { selectedCount: 1 },
      },
      };
    });
    const compactIfNeeded = vi.fn(async (): Promise<SessionCompactionOrchestrationResult> => ({
      status: 'skipped',
      events: [],
    }));
    const toolDefinitions = [toolDefinition('read_file')];
    const service = new AgentLoopInitialModelInputPreparationService({
      contextService: {
        createBaselineContext: vi.fn(() => ({
          contextBudgetPolicy: {
            modelContextWindow: 4096,
            reservedOutputTokens: 512,
            keepRecentTokens: 3584,
          },
        })),
      },
      sessionContextInputService: {
        buildSessionContextInput: sessionContextInput,
      },
      sourceOverrideProvider: {
        resolveModelInputSourceOverrides: vi.fn(() => ({
          requestedCwd: 'packages/core',
        })),
      },
      memoryRecallService: {
        recallForNewUserInput: memoryRecall,
      },
      modelCallInputBuildService: {
        buildModelCallInput: vi.fn(async (input: BuildModelCallInputInput) => {
          buildInputs.push(input);
          return successfulModelStepInputBuild(input);
        }),
      },
      compactionOrchestrator: {
        compactIfNeeded,
      },
    });

    const preparation = await service.prepare({
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
        createdAt,
      },
      toolDefinitions,
      createdAt,
      memoryEnabled: true,
    });

    expect(buildInputs.map((input) => input.contextKind)).toEqual(['compaction-probe']);
    expect(buildInputs[0]).toMatchObject({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai',
      modelId: 'gpt-test',
      modelContextWindow: 4096,
      projectId: 'project-1',
      projectRoot: 'C:/repo',
      requestedCwd: 'packages/core',
      permissionMode: 'plan',
      toolDefinitions,
      budgetPolicy: {
        modelContextWindow: Number.MAX_SAFE_INTEGER,
        reservedOutputTokens: 0,
        keepRecentTokens: Number.MAX_SAFE_INTEGER,
      },
      runInputFacts: expect.objectContaining({
        inputKind: 'user_input',
        effectiveUserText: '/review src',
      }),
    });
    expect(memoryRecall).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      projectRoot: 'C:/repo',
      sessionId: 'session-1',
      runId: 'run-1',
      modelStepId: 'step-1',
      queryText: '/review src',
      providerId: 'openai',
      modelId: 'gpt-test',
      enabled: true,
      createdAt,
    }));
    expect(memoryRecallInput?.effectiveCwd).toContain('packages');

    await preparation.startCompaction();

    expect(compactIfNeeded).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai',
      modelId: 'gpt-test',
      budgetProbeInputContext: expect.objectContaining({
        contextId: 'context:compaction-probe',
      }),
      budgetPolicy: {
        modelContextWindow: 4096,
        reservedOutputTokens: 512,
        keepRecentTokens: 3584,
      },
      startSequence: 1,
    }));

    const initial = await preparation.buildInitialModelInput();

    expect(initial.inputContext.contextId).toBe('context:initial');
    expect(sessionContextInput).toHaveBeenCalledTimes(2);
    expect(buildInputs.map((input) => input.contextKind)).toEqual(['compaction-probe', 'initial']);
    expect(buildInputs[1]).toMatchObject({
      contextKind: 'initial',
      toolDefinitions,
      memoryRecallSources: expect.arrayContaining([expect.objectContaining({ sourceId: 'memory:1' })]),
      memoryRecallSeed: {
        queryText: '/review src',
        metadata: { selectedCount: 1 },
      },
      budgetPolicy: {
        modelContextWindow: 4096,
        reservedOutputTokens: 512,
        keepRecentTokens: 3584,
      },
      runInputFacts: expect.objectContaining({
        inputKind: 'user_input',
      }),
    });
  });
});

const createdAt = '2026-06-21T00:00:00.000Z';

const session = {
  sessionId: 'session-1',
  title: 'Session',
  status: 'active',
  workspaceId: 'project-1',
  workspacePath: 'C:/repo',
  createdAt,
  updatedAt: createdAt,
} as const;

const run = {
  runId: 'run-1',
  sessionId: 'session-1',
  triggerMessageId: 'message-user',
  mode: 'default',
  goal: 'Hello',
  status: 'running',
  createdAt,
  startedAt: createdAt,
} as const;

const step = {
  stepId: 'step-1',
  runId: 'run-1',
  kind: 'model',
  status: 'running',
  title: 'Model response',
  startedAt: createdAt,
} as const;

const userMessage = {
  messageId: 'message-user',
  sessionId: 'session-1',
  runId: 'run-1',
  role: 'user',
  content: 'Hello',
  status: 'completed',
  createdAt,
  completedAt: createdAt,
} as const;

function successfulModelStepInputBuild(input: BuildModelCallInputInput): BuildModelCallInputResult {
  return {
    buildRequest: {} as never,
    inputContext: modelInputContext(input.contextKind, input),
    toolDefinitions: input.toolDefinitions ?? [],
    instructionSources: [],
    availableCapabilitySummary: 'Available tools: none.',
  };
}

function modelInputContext(contextKind: string, input: BuildModelCallInputInput): ModelInputContext {
  return {
    contextId: `context:${contextKind}`,
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
  };
}

function toolDefinition(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
    availability: { status: 'available' },
  };
}
