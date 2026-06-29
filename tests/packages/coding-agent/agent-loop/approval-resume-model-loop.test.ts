// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BuildModelCallInputInput, BuildModelCallInputResult } from '@megumi/coding-agent/context';
import type { ModelInputContext, ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { RunStep } from '@megumi/shared/session';
import {
  ensureToolCallRunnerService,
  PendingApprovalRegistry,
  resumeToolApprovalAgentLoop,
  streamApprovalResumeModelLoop,
} from '@megumi/coding-agent/agent-loop';
import type { ApprovalResumeGroup } from '@megumi/coding-agent/agent-loop/tool-call/approval/approval-resume-group';
import type { PendingToolApprovalResume } from '@megumi/coding-agent/agent-loop/tool-call';

describe('approval resume model loop owner', () => {
  it('creates a resumed request and streams the resumed model/tool loop', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const modelEvents = streamApprovalResumeModelLoop({
      pendingRequest: runtimeRequest(),
      resumedStep: resumedStep(),
      resumedInputContext: modelInputContext('resumed-context'),
      decidedAt: '2026-06-28T10:00:00.000Z',
      toolRuntime: ensureToolCallRunnerService({
        async handleToolCalls() {
          return {
            assistantMessageId: 'assistant-1',
            toolResults: [],
            pendingApprovals: [],
            runtimeEvents: [],
            nextModelInputReady: true,
          };
        },
        async resumeToolApproval() {
          return undefined;
        },
      }),
      modelCallPort: {
        async *streamModelCall({ request }) {
          requests.push(request);
          yield modelStepStarted(request);
        },
      },
      modelCallInputBuildService: {
        async buildModelCallInput() {
          throw new Error('Next model input context should not be built for a terminal resumed model call.');
        },
      },
      sourceOverrideProvider: {
        resolveModelInputSourceOverrides() {
          return {};
        },
      },
      ids: {
        nextEventId: () => 'event-2',
        nextStepId: () => 'step-next',
        nextModelStepId: () => 'model-step-resumed',
      },
    });

    const events = await collect(modelEvents.modelEvents);

    expect(modelEvents.pendingApprovalResumes).toEqual([]);
    expect(events.map((event) => event.eventType)).toEqual(['model.step.started']);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-resumed',
      modelStepId: 'model-step-resumed',
      createdAt: '2026-06-28T10:00:00.000Z',
    });
    expect(requests[0]?.inputContext.contextId).toBe('resumed-context');
  });

  it('owns approval resume resolution through resumed model-loop streaming', async () => {
    const appended: RuntimeEvent[] = [];
    const registry = new PendingApprovalRegistry<ApprovalResumeGroup>({
      getRunId: (group) => group.request.runId,
    });
    const group = approvalResumeGroup();
    registry.register(group);

    const events = await collect(resumeToolApprovalAgentLoop({
      approvalResume: group,
      resumeInput: {
        approvalRequestId: 'approval-1',
        decision: 'approved',
        decidedAt: '2026-06-28T10:00:00.000Z',
      },
      registry,
      lastSequenceForRun: () => 10,
      appendEvent(event) {
        appended.push(event);
      },
      runRepository: {
        getRun: () => ({ ...group.run, status: 'waiting_for_approval' }),
        saveRun: (run) => run,
      },
      stepRepository: {
        saveStep: (step) => step,
      },
      modelCallPort: {
        async *streamModelCall({ request }) {
          yield modelStepStarted(request);
        },
      },
      modelCallInputBuildService: {
        async buildModelCallInput(input) {
          return modelInputBuildResult(input, 'approval-resume-context');
        },
      },
      sourceOverrideProvider: {
        resolveModelInputSourceOverrides() {
          return {};
        },
      },
      ids: {
        eventId: () => `event-${appended.length + 1}`,
        stepId: () => 'step-resumed',
        nextEventId: () => `event-model-${appended.length + 1}`,
        nextStepId: () => 'step-next',
        nextModelStepId: () => 'model-step-resumed',
      },
      clock: {
        now: () => '2026-06-28T10:00:00.000Z',
      },
      recordModelCallEvents(recordInput) {
        return recordInput.modelEvents;
      },
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'approval.resolved',
      'run.status.changed',
      'tool.result.created',
      'model.step.started',
    ]);
    expect(appended.map((event) => event.eventType)).toEqual([
      'approval.resolved',
      'run.status.changed',
      'tool.result.created',
    ]);
    expect(registry.getByApprovalId('approval-1')).toBeUndefined();
  });
});

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const event of events) {
    output.push(event);
  }
  return output;
}

function runtimeRequest(): ModelStepRuntimeRequest {
  return {
    requestId: 'request-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-approval',
    modelStepId: 'model-step-approval',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    inputContext: modelInputContext('approval-context'),
    createdAt: '2026-06-28T09:59:00.000Z',
  };
}

function approvalResumeGroup(): ApprovalResumeGroup {
  const pending = pendingApprovalResume();
  return {
    groupId: 'group-1',
    request: runtimeRequest(),
    run: {
      runId: 'run-1',
      sessionId: 'session-1',
      mode: 'default',
      goal: 'test',
      status: 'waiting_for_approval',
      createdAt: '2026-06-28T09:58:00.000Z',
    },
    step: {
      stepId: 'step-approval',
      runId: 'run-1',
      kind: 'model',
      status: 'waiting_for_approval',
      title: 'Model response',
      startedAt: '2026-06-28T09:59:00.000Z',
    },
    userMessageId: 'message-user',
    pendingByApprovalId: new Map([['approval-1', pending]]),
    resolvedResults: [],
    toolRuntime: ensureToolCallRunnerService({
      async handleToolCalls() {
        return {
          assistantMessageId: 'assistant-1',
          toolResults: [],
          pendingApprovals: [],
          runtimeEvents: [],
          nextModelInputReady: true,
        };
      },
      async resumeToolApproval() {
        return {
          assistantMessageId: 'assistant-1',
          toolResults: [toolResult()],
          pendingApprovals: [],
          runtimeEvents: [],
          nextModelInputReady: true,
        };
      },
    }),
  };
}

function pendingApprovalResume(): PendingToolApprovalResume {
  return {
    pendingApproval: {
      approvalRequest: {
        approvalRequestId: 'approval-1',
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        stepId: 'step-approval',
        toolName: 'read_file',
        toolExecutionId: 'tool-execution-1',
        capabilities: ['project_read'],
        riskLevel: 'low',
        title: 'Approve read_file',
        summary: 'Approval required.',
        preview: { action: 'read file', targets: [] },
        requestedScope: 'once',
        status: 'pending',
        createdAt: '2026-06-28T09:59:30.000Z',
      },
      toolCall: {
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        modelStepId: 'model-step-approval',
        providerToolCallId: 'provider-call-1',
        toolName: 'read_file',
        input: {},
        inputPreview: { summary: 'read_file', targets: [], redactionState: 'none' },
        status: 'created',
        createdAt: '2026-06-28T09:59:00.000Z',
      },
      toolExecution: {
        toolExecutionId: 'tool-execution-1',
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        stepId: 'step-approval',
        assistantMessageId: 'model-step-approval',
        callOrder: 0,
        toolName: 'read_file',
        input: {},
        inputPreview: { summary: 'read_file', targets: [], redactionState: 'none' },
        status: 'awaitingApproval',
        requestedAt: '2026-06-28T09:59:00.000Z',
        continuationEmitted: false,
      },
    },
    request: runtimeRequest(),
    accumulatedToolCalls: [],
    accumulatedToolResults: [],
    accumulatedProviderStates: [],
  };
}

function toolResult() {
  return {
    toolResultId: 'tool-result-1',
    toolCallId: 'tool-call-1',
    toolExecutionId: 'tool-execution-1',
    runId: 'run-1',
    kind: 'success' as const,
    textContent: 'approved result',
    redactionState: 'none' as const,
    createdAt: '2026-06-28T10:00:00.000Z',
  };
}

function modelInputBuildResult(
  input: BuildModelCallInputInput,
  contextId: string,
): BuildModelCallInputResult {
  return {
    buildRequest: {} as BuildModelCallInputResult['buildRequest'],
    inputContext: {
      ...modelInputContext(contextId),
      sessionId: input.sessionId,
      runId: input.runId,
      stepId: input.stepId,
      builtAt: input.builtAt,
    },
    toolDefinitions: input.toolDefinitions ?? [],
    instructionSources: [],
    availableCapabilitySummary: 'Available tools: none.',
  };
}

function resumedStep(): RunStep {
  return {
    stepId: 'step-resumed',
    runId: 'run-1',
    kind: 'model',
    status: 'running',
    title: 'Model response',
    startedAt: '2026-06-28T10:00:00.000Z',
  };
}

function modelInputContext(contextId: string): ModelInputContext {
  return {
    contextId,
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    builtAt: '2026-06-28T10:00:00.000Z',
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
      buildReason: 'test',
      selectedSources: [],
      excludedSources: [],
    },
  };
}

function modelStepStarted(request: ModelStepRuntimeRequest): RuntimeEvent {
  return {
    schemaVersion: 1,
    eventId: 'event-1',
    eventType: 'model.step.started',
    runId: request.runId,
    sessionId: request.sessionId,
    stepId: request.stepId,
    requestId: request.requestId,
    sequence: 1,
    createdAt: request.createdAt,
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: {
      modelStepId: String(request.modelStepId),
      providerId: request.providerId,
      modelId: String(request.modelId),
    },
  };
}
