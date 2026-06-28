// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { prepareApprovalResumeModelInput } from '@megumi/coding-agent/run';
import type { BuildModelCallInputInput, BuildModelCallInputResult } from '@megumi/coding-agent/run/context';
import type { ModelStepProviderState, ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { RunStep } from '@megumi/shared/session';
import type { ToolCall, ToolResult } from '@megumi/shared/tool';

describe('approval resume model input owner', () => {
  it('creates a resumed model step and builds approval-resume model input', async () => {
    const savedSteps: RunStep[] = [];
    const buildInputs: BuildModelCallInputInput[] = [];
    const buildResult = modelInputBuildResult();
    const pendingToolResult = toolResult('tool-result-1');
    const resolvedToolResult = toolResult('tool-result-2');
    const pendingProviderState = providerState('provider-state-1');

    const result = await prepareApprovalResumeModelInput({
      pending: {
        pendingApproval: {} as never,
        request: request(),
        accumulatedToolCalls: [toolCall('tool-call-1')],
        accumulatedToolResults: [pendingToolResult],
        accumulatedProviderStates: [pendingProviderState],
      },
      resolvedResults: [resolvedToolResult],
      decidedAt: '2026-06-14T00:00:10.000Z',
      projectRoot: 'C:/workspace/project',
      permissionMode: 'accept_edits',
      memoryRecallSources: [{
        sourceId: 'memory-source-1',
        kind: 'long_term_memory',
        content: 'Remember the repo convention.',
      }] as never,
      memoryRecallSeed: {
        source: 'approval-resume-test',
        query: 'resume',
      } as never,
      repository: {
        saveStep: (step) => {
          savedSteps.push(step);
          return step;
        },
      },
      modelCallInputBuildService: {
        buildModelCallInput: async (input) => {
          buildInputs.push(input);
          return buildResult;
        },
      },
      sourceOverrideProvider: {
        resolveModelInputSourceOverrides: (input) => ({
          requestedCwd: `cwd:${input.stepId}`,
          globalInstructionDirs: ['C:/instructions'],
        }),
      },
      ids: {
        stepId: () => 'step-resumed-1',
      },
    });

    expect(savedSteps).toEqual([{
      stepId: 'step-resumed-1',
      runId: 'run-1',
      kind: 'model',
      status: 'running',
      title: 'Model response',
      startedAt: '2026-06-14T00:00:10.000Z',
    }]);
    expect(result.step).toEqual(savedSteps[0]);
    expect(result.toolResults).toEqual([pendingToolResult, resolvedToolResult]);
    expect(result.modelInput).toBe(buildResult);
    expect(buildInputs).toHaveLength(1);
    expect(buildInputs[0]).toMatchObject({
      baseInputContext: request().inputContext,
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-resumed-1',
      contextKind: 'approval-resume',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      projectRoot: 'C:/workspace/project',
      requestedCwd: 'cwd:step-resumed-1',
      globalInstructionDirs: ['C:/instructions'],
      permissionMode: 'accept_edits',
      toolDefinitions: [{ name: 'read_file' }],
      toolCalls: [{ toolCallId: 'tool-call-1' }],
      toolResults: [pendingToolResult, resolvedToolResult],
      providerStates: [pendingProviderState],
      memoryRecallSources: [{
        sourceId: 'memory-source-1',
        kind: 'long_term_memory',
        content: 'Remember the repo convention.',
      }],
      memoryRecallSeed: {
        source: 'approval-resume-test',
        query: 'resume',
      },
      builtAt: '2026-06-14T00:00:10.000Z',
    });
  });
});

function request(): ModelStepRuntimeRequest {
  return {
    requestId: 'request-1',
    runId: 'run-1',
    sessionId: 'session-1',
    stepId: 'step-1',
    modelStepId: 'model-step-1',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    toolDefinitions: [{ name: 'read_file' }],
    inputContext: {
      contextId: 'context-1',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      modelStepId: 'model-step-1',
      builtAt: '2026-06-14T00:00:01.000Z',
      budget: {
        maxTokens: 8_000,
        reservedTokens: 1_000,
      },
      parts: [],
      trace: {
        traceId: 'trace-1',
        items: [],
      },
    },
    createdAt: '2026-06-14T00:00:01.000Z',
  } as unknown as ModelStepRuntimeRequest;
}

function toolCall(toolCallId: string): ToolCall {
  return {
    toolCallId,
    runId: 'run-1',
    modelStepId: 'model-step-1',
    providerToolCallId: `provider-${toolCallId}`,
    toolName: 'read_file',
    input: { path: 'README.md' },
    inputPreview: {
      summary: 'read_file',
      targets: ['README.md'],
    },
  } as unknown as ToolCall;
}

function toolResult(toolResultId: string): ToolResult {
  return {
    toolResultId,
    toolCallId: `tool-call-${toolResultId}`,
    toolExecutionId: `tool-execution-${toolResultId}`,
    runId: 'run-1',
    modelStepId: 'model-step-1',
    toolName: 'read_file',
    kind: 'text',
    status: 'success',
    textContent: `result for ${toolResultId}`,
    redactionState: 'none',
    createdAt: '2026-06-14T00:00:03.000Z',
  } as unknown as ToolResult;
}

function providerState(stateId: string): ModelStepProviderState {
  return {
    stateId,
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    kind: 'response_id',
    value: `response-${stateId}`,
    createdAt: '2026-06-14T00:00:04.000Z',
  } as unknown as ModelStepProviderState;
}

function modelInputBuildResult(): BuildModelCallInputResult {
  return {
    buildRequest: {} as BuildModelCallInputResult['buildRequest'],
    inputContext: {
      contextId: 'context-resumed',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-resumed-1',
      modelStepId: 'model-step-1',
      builtAt: '2026-06-14T00:00:10.000Z',
      budget: {
        maxTokens: 8_000,
        reservedTokens: 1_000,
      },
      parts: [],
      trace: {
        traceId: 'trace-resumed',
        items: [],
      },
    },
    toolDefinitions: [],
    instructionSources: [],
    availableCapabilitySummary: '',
  } as unknown as BuildModelCallInputResult;
}
