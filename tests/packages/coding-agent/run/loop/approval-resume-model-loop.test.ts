// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ModelInputContext, ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { RunStep } from '@megumi/shared/session';
import { ensureToolCallRunnerService } from '@megumi/coding-agent/run/tool-calls';
import { streamApprovalResumeModelLoop } from '@megumi/coding-agent/run/loop';

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
