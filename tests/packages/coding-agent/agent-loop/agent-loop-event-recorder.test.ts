// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { Run, RunStep } from '@megumi/shared/session';
import {
  createAgentLoopEventRecorder,
  PendingApprovalRegistry,
  type ApprovalResumeGroup,
} from '@megumi/coding-agent/agent-loop';

describe('agent loop event recorder', () => {
  it('records model events through assistant reply completion and terminal lifecycle', async () => {
    const request = modelRequest();
    const run = runningRun();
    const step = runningStep();
    const appended: RuntimeEvent[] = [];
    const assistantReplies: unknown[] = [];
    const memoryCaptures: unknown[] = [];
    const legacyEvents: string[] = [];
    const runs = new Map<string, Run>([[run.runId, run]]);
    const steps = new Map<string, RunStep>([[step.stepId, step]]);

    const recorder = createAgentLoopEventRecorder({
      clock: { now: () => '2026-06-29T10:00:05.000Z' },
      ids: {
        eventId: nextId('event'),
        stepId: nextId('step'),
      },
      events: {
        lastSequenceForRun: () => appended.at(-1)?.sequence ?? 1,
        normalizeWithModelRequest(event, _request, input) {
          return {
            ...event,
            requestId: _request.requestId,
            runtimeContext: _request.runtimeContext,
            sequence: Math.max(event.sequence, input.afterSequence + 1),
          };
        },
        withModelRequestMetadata(event, _request) {
          return {
            ...event,
            requestId: _request.requestId,
            runtimeContext: _request.runtimeContext,
          };
        },
        append(event) {
          appended.push(event);
          return event;
        },
      },
      runRepository: {
        getRun: (runId) => runs.get(runId),
        saveRun(saved) {
          runs.set(saved.runId, saved);
          return saved;
        },
      },
      stepRepository: {
        listStepsByRun: () => [...steps.values()],
        saveStep(saved) {
          steps.set(saved.stepId, saved);
          return saved;
        },
      },
      legacyModelSteps: {
        persistFromEvent(input) {
          legacyEvents.push(input.event.eventType);
        },
      },
      assistantReplies: {
        commit(input) {
          assistantReplies.push(input);
        },
      },
      postRunHooks: {
        scheduleRunCompletedMemoryCapture(input) {
          memoryCaptures.push(input);
        },
      },
      memory: {
        isEnabled: () => true,
      },
      approvals: {
        registry: new PendingApprovalRegistry<ApprovalResumeGroup>({
          getRunId: (group) => group.request.runId,
        }),
      },
    });

    const events = await collect(recorder.recordModelCallEvents({
      request,
      modelEvents: collectable([
        runtimeEvent('assistant.output.delta', 2, { delta: 'Partial ' }),
        runtimeEvent('assistant.output.completed', 3, { content: 'Final answer.' }),
        runtimeEvent('model.step.completed', 4, { finishReason: 'stop', modelStepId: 'model-step-1' }),
      ]),
      pendingApprovalResumes: [],
      run,
      step,
      userMessageId: 'message-user',
      projectId: 'project-1',
      projectRoot: 'C:/workspace/project',
      permissionMode: 'default',
      startSequence: 1,
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'assistant.output.delta',
      'assistant.output.completed',
      'model.step.completed',
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect(assistantReplies).toEqual([{
      sessionId: 'session-1',
      runId: 'run-1',
      content: 'Final answer.',
      completedAt: '2026-06-29T10:00:05.000Z',
    }]);
    expect(memoryCaptures).toEqual([expect.objectContaining({
      runId: 'run-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      providerId: 'openai',
      modelId: 'gpt-test',
      userText: 'User request.',
      assistantText: 'Final answer.',
      hasProject: true,
      memoryEnabled: true,
    })]);
    expect(legacyEvents).toContain('model.step.completed');
    expect(runs.get('run-1')?.status).toBe('completed');
  });
});

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

async function* collectable<T>(items: readonly T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

function nextId(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

function modelRequest(): ModelStepRuntimeRequest {
  return {
    requestId: 'request-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    providerId: 'openai',
    modelId: 'gpt-test',
    inputContext: {
      contextId: 'context-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      builtAt: '2026-06-29T10:00:00.000Z',
      parts: [{
        partId: 'part-user',
        kind: 'current_turn',
        role: 'user',
        text: 'User request.',
        sourceRefs: [],
        priority: 100,
        budgetStatus: 'included_full',
      }],
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
    },
    createdAt: '2026-06-29T10:00:00.000Z',
  };
}

function runningRun(): Run {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    mode: 'default',
    goal: 'User request.',
    status: 'running',
    createdAt: '2026-06-29T10:00:00.000Z',
  };
}

function runningStep(): RunStep {
  return {
    stepId: 'step-1',
    runId: 'run-1',
    kind: 'model',
    status: 'running',
    title: 'Model response',
    startedAt: '2026-06-29T10:00:00.000Z',
  };
}

function runtimeEvent(
  eventType: RuntimeEvent['eventType'],
  sequence: number,
  payload: RuntimeEvent['payload'],
): RuntimeEvent {
  return {
    eventId: `event-input-${sequence}`,
    eventType,
    runId: 'run-1',
    sessionId: 'session-1',
    stepId: 'step-1',
    sequence,
    createdAt: `2026-06-29T10:00:0${sequence}.000Z`,
    schemaVersion: 1,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload,
  };
}
