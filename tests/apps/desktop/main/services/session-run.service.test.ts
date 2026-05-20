// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { SessionRunRepository } from '@megumi/db/repos/session-run.repo';
import { RunModeRepository } from '@megumi/db/repos/run-mode.repo';
import {
  SessionRunService,
  type SessionRunContextService,
  type SessionRunServiceOptions,
} from '@megumi/desktop/main/services/session-run.service';
import { RunModeService } from '@megumi/desktop/main/services/run-mode.service';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { RunContext } from '@megumi/shared/run-context-contracts';
import type { RunAction } from '@megumi/shared/session-run-contracts';
import { RUN_MODE_PRESET_DEFAULTS } from '@megumi/shared/run-mode-contracts';
import type { ApprovalRequest, ToolCall, ToolResult } from '@megumi/shared/tool-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

let db: Database.Database | null = null;

function createService() {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new SessionRunRepository(db);
  return new SessionRunService({
    repository,
    clock: { now: () => '2026-05-15T00:00:00.000Z' },
    ids: {
      sessionId: () => 'session-1',
      runId: () => 'run-1',
      stepId: () => 'step-1',
      actionId: () => 'action-1',
      observationId: () => 'observation-1',
      eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      messageId: () => 'message-1',
    },
  });
}

function createServiceWithContextRecorder(records: unknown[]) {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new SessionRunRepository(db);
  return new SessionRunService({
    repository,
    contextService: {
      createBaselineContext: (input) => {
        records.push(input);
        return {
          contextId: `context:${input.runId}`,
          runId: input.runId,
          workspaceBoundary: {
            workspaceId: input.workspaceId,
            rootPath: input.workspacePath,
            symlinkPolicy: 'deny_outside_workspace',
            outsideWorkspacePolicy: 'deny',
            secretPolicySummary: 'No secrets.',
            createdAt: '2026-05-15T00:00:00.000Z',
          },
          goal: input.goal,
          constraints: [],
          inlineContents: [],
          resourceRefs: [],
          conversationRefs: [],
          messageSummaries: [],
          workspaceSources: [],
          toolObservationRefs: [],
          memoryRecallRefs: [],
          policySummary: {
            workspaceAccess: 'workspace-read',
            restrictedResources: [],
            approvalSummary: 'No approval.',
            sandboxSummary: 'Read-only.',
          },
          modelCapabilitySummary: input.modelCapabilitySummary,
          budget: {
            modelContextWindow: input.modelCapabilitySummary.modelContextWindow,
            reservedOutputTokens: input.modelCapabilitySummary.reservedOutputTokens,
            availableInputTokens: input.modelCapabilitySummary.availableInputTokens,
            budgetPolicy: 'balanced',
            packingStrategy: 'priority_then_recent',
            truncationRecords: [],
          },
          buildMetadata: {
            buildReason: 'run_baseline',
            builtAt: '2026-05-15T00:00:00.000Z',
            selectionRecordIds: [],
            redactionRecordIds: [],
            truncationRecordIds: [],
          },
          createdAt: '2026-05-15T00:00:00.000Z',
        } satisfies RunContext;
      },
    },
    clock: { now: () => '2026-05-15T00:00:00.000Z' },
    ids: {
      sessionId: () => 'session-1',
      runId: () => 'run-1',
      stepId: () => 'step-1',
      actionId: () => 'action-1',
      observationId: () => 'observation-1',
      eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      messageId: () => 'message-1',
    },
  });
}

function createServiceWithRunModeRecorder(records: unknown[]) {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new SessionRunRepository(db);
  return new SessionRunService({
    repository,
    runModeService: {
      createModeSnapshot: (input) => {
        records.push({ type: 'snapshot', input });
        return {
          modeSnapshotId: 'mode-snapshot:1',
          runId: input.runId,
          modeLabel: input.mode,
          mode: input.modeSnapshot ?? RUN_MODE_PRESET_DEFAULTS.chat,
          createdAt: input.createdAt,
        };
      },
      linkAcceptedSourcePlan: (input) => {
        records.push({ type: 'sourcePlan', input });
        return input;
      },
      createPlanRecordForRun: (input) => {
        records.push({ type: 'planRecord', input });
        return undefined;
      },
      getPlanByRun: () => undefined,
      updatePlanStatus: () => {
        throw new Error('not implemented');
      },
    },
    clock: { now: () => '2026-05-15T00:00:00.000Z' },
    ids: {
      sessionId: () => 'session-1',
      runId: () => 'run-1',
      stepId: () => 'step-1',
      actionId: () => 'action-1',
      observationId: () => 'observation-1',
      eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      messageId: () => 'message-1',
    },
  });
}

function createServiceWithFailingHostBoundary(records: unknown[]) {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new SessionRunRepository(db);
  return new SessionRunService({
    repository,
    runModeService: {
      createModeSnapshot: (input) => {
        records.push({ type: 'snapshot', input });
        return {
          modeSnapshotId: 'mode-snapshot:1',
          runId: input.runId,
          modeLabel: input.mode,
          mode: input.modeSnapshot ?? RUN_MODE_PRESET_DEFAULTS.plan,
          createdAt: input.createdAt,
        };
      },
      linkAcceptedSourcePlan: (input) => {
        records.push({ type: 'sourcePlan', input });
        return input;
      },
      createPlanRecordForRun: (input) => {
        records.push({ type: 'planRecord', input });
        return undefined;
      },
      getPlanByRun: () => undefined,
      updatePlanStatus: () => {
        throw new Error('not implemented');
      },
    },
    hostBoundary: {
      handleAction: (_action: RunAction) => {
        throw new Error('plan failed');
      },
    },
    clock: { now: () => '2026-05-15T00:00:00.000Z' },
    ids: {
      sessionId: () => 'session-1',
      runId: () => 'run-1',
      stepId: () => 'step-1',
      actionId: () => 'action-1',
      observationId: () => 'observation-1',
      eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      messageId: () => 'message-1',
      debugId: () => 'debug-1',
    },
  });
}

function createServiceWithModelStepStream(events: RuntimeEvent[], options?: {
  contextService?: SessionRunContextService;
  runModeService?: SessionRunServiceOptions['runModeService'];
  toolUseHandler?: SessionRunServiceOptions['toolUseHandler'];
  onRequest?: (request: ModelStepRuntimeRequest) => void;
}) {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new SessionRunRepository(db);
  return new SessionRunService({
    repository,
    ...(options?.contextService ? { contextService: options.contextService } : {}),
    ...(options?.runModeService ? { runModeService: options.runModeService } : {}),
    ...(options?.toolUseHandler ? { toolUseHandler: options.toolUseHandler } : {}),
    modelStepProvider: {
      streamModelStep: async function* (request) {
        options?.onRequest?.(request);
        yield* events;
      },
      cancelModelStep: () => true,
    },
    clock: { now: () => '2026-05-17T00:00:00.000Z' },
    ids: {
      sessionId: () => 'session-1',
      runId: () => 'run-1',
      stepId: () => 'step-1',
      actionId: () => 'action-1',
      observationId: () => 'observation-1',
      eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      messageId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `message-${index}`;
        };
      })(),
    },
  });
}

function toolUseCreatedEvent(sequence: number): RuntimeEvent {
  return {
    eventId: `event-tool-use-${sequence}`,
    schemaVersion: 1,
    eventType: 'tool.use.created',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    sequence,
    createdAt: '2026-05-17T00:00:01.000Z',
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: {
      toolUseId: 'tool-use-1',
      modelStepId: 'model-step-1',
      providerToolUseId: 'provider-tool-use-1',
      toolName: 'read_file',
      input: { path: 'package.json' },
    },
  };
}

function modelStepCompletedEvent(sequence: number): RuntimeEvent {
  return {
    eventId: `event-model-step-completed-${sequence}`,
    schemaVersion: 1,
    eventType: 'model.step.completed',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    sequence,
    createdAt: '2026-05-17T00:00:02.000Z',
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: {
      modelStepId: 'model-step-1',
      finishReason: 'tool_calls',
    },
  };
}

function modelOutputDeltaEvent(input: {
  sequence: number;
  delta: string;
  stepId?: string;
  modelStepId?: string;
}): RuntimeEvent {
  return {
    eventId: `event-model-output-delta-${input.sequence}`,
    schemaVersion: 1,
    eventType: 'model.output.delta',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: input.stepId ?? 'step-1',
    sequence: input.sequence,
    createdAt: '2026-05-17T00:00:01.000Z',
    source: 'provider',
    visibility: 'user',
    persist: 'transient',
    payload: {
      modelStepId: input.modelStepId ?? 'model-step-1',
      delta: input.delta,
    },
  };
}

function assistantOutputCompletedEvent(sequence: number): RuntimeEvent {
  return {
    eventId: `event-assistant-completed-${sequence}`,
    schemaVersion: 1,
    eventType: 'assistant.output.completed',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    sequence,
    createdAt: '2026-05-17T00:00:03.000Z',
    source: 'provider',
    visibility: 'user',
    persist: 'required',
    payload: {
      content: 'Final answer after tool result.',
    },
  };
}

function createToolResult(): ToolResult {
  return {
    toolResultId: 'tool-result-1',
    toolUseId: 'tool-use-1',
    runId: 'run-1',
    kind: 'success',
    structuredContent: { text: 'package contents' },
    textContent: 'package contents',
    redactionState: 'none',
    createdAt: '2026-05-17T00:00:02.500Z',
  };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('SessionRunService', () => {
  it('creates durable sessions', () => {
    const service = createService();

    const session = service.createSession({
      title: 'Agent work',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(session).toMatchObject({
      sessionId: 'session-1',
      status: 'active',
      title: 'Agent work',
    });
    expect(service.listSessions()).toEqual([session]);
  });

  it('starts a minimal agent run and persists lifecycle facts', async () => {
    const service = createService();
    service.createSession({
      title: 'Agent work',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    const result = await service.startRun({
      sessionId: 'session-1',
      goal: 'Answer',
      mode: 'chat',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(result.run).toMatchObject({
      runId: 'run-1',
      status: 'completed',
    });
    expect(service.listRuntimeEventsByRun('run-1').map((event) => event.eventType)).toContain('run.completed');
  });

  it('creates a baseline context for workspace-bound runs before invoking the runtime', async () => {
    const baselineInputs: unknown[] = [];
    const service = createServiceWithContextRecorder(baselineInputs);
    service.createSession({
      title: 'Agent work',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    await service.startRun({
      sessionId: 'session-1',
      goal: 'Use workspace context',
      mode: 'chat',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(baselineInputs).toEqual([
      expect.objectContaining({
        runId: 'run-1',
        goal: 'Use workspace context',
        workspaceId: 'workspace-1',
        workspacePath: 'C:/all/work/study/megumi',
      }),
    ]);
  });

  it('passes mode snapshots and source plan ids into the core run', async () => {
    const records: unknown[] = [];
    const service = createServiceWithRunModeRecorder(records);
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    const result = await service.startRun({
      sessionId: 'session-1',
      goal: 'Execute plan',
      mode: 'execute',
      modeSnapshot: RUN_MODE_PRESET_DEFAULTS.execute,
      sourcePlanId: 'plan:accepted',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(result.run.modeSnapshotRef).toBe('mode-snapshot:1');
    expect(result.run.sourcePlanId).toBe('plan:accepted');
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'snapshot' }),
      expect.objectContaining({ type: 'sourcePlan' }),
    ]));
  });

  it('does not create a proposed plan artifact for failed plan runs', async () => {
    const records: unknown[] = [];
    const service = createServiceWithFailingHostBoundary(records);
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    const result = await service.startRun({
      sessionId: 'session-1',
      goal: 'Write a plan',
      mode: 'plan',
      modeSnapshot: RUN_MODE_PRESET_DEFAULTS.plan,
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(result.run.status).toBe('failed');
    expect(records).toEqual([
      expect.objectContaining({ type: 'snapshot' }),
    ]);
  });

  it('sends a session message by persisting user message, run, and model step', async () => {
    const service = createServiceWithModelStepStream([
      {
        eventId: 'event-assistant-delta',
        schemaVersion: 1,
        eventType: 'assistant.output.delta',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        sequence: 1,
        createdAt: '2026-05-17T00:00:01.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'transient',
        payload: { delta: 'Hello' },
      },
      {
        eventId: 'event-assistant-completed',
        schemaVersion: 1,
        eventType: 'assistant.output.completed',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        sequence: 2,
        createdAt: '2026-05-17T00:00:02.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'required',
        payload: { content: 'Hello' },
      },
    ]);
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Hello',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    const streamed = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(result.data).toEqual({ requestId: 'ipc-session-message-send-1' });
    expect(streamed.map((event) => event.eventType)).toEqual([
      'run.started',
      'assistant.output.delta',
      'assistant.output.completed',
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect(streamed[0]).toMatchObject({
      eventType: 'run.started',
      requestId: 'ipc-session-message-send-1',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 1,
    });
    expect(streamed.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(service.listRuntimeEventsByRun('run-1').map((event) => event.eventType)).toContain('assistant.output.completed');
    expect(service.listMessagesBySession('session-1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'Hello', runId: 'run-1' }),
      expect.objectContaining({ role: 'assistant', content: 'Hello', runId: 'run-1' }),
    ]));
  });

  it('continues session message runs through tool results before completing with final assistant output', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const toolResult = createToolResult();
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateDatabase(db);
    const repository = new SessionRunRepository(db);
    const service = new SessionRunService({
      repository,
      modelStepProvider: {
        streamModelStep: async function* (request) {
          requests.push(request);

          if (requests.length === 1) {
            yield toolUseCreatedEvent(1);
            yield modelStepCompletedEvent(2);
            return;
          }

          yield {
            ...assistantOutputCompletedEvent(1),
            stepId: request.stepId,
          };
        },
        cancelModelStep: () => true,
      },
      toolUseHandler: {
        async handleToolUses() {
          return {
            toolResults: [toolResult],
          };
        },
      },
      clock: { now: () => '2026-05-17T00:00:04.000Z' },
      ids: {
        sessionId: () => 'session-1',
        runId: () => 'run-1',
        stepId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `step-${index}`;
          };
        })(),
        eventId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `service-event-${index}`;
          };
        })(),
        messageId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `message-${index}`;
          };
        })(),
      },
    });
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Read package.json',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    const streamed = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      stepId: 'step-2',
      modelStepId: expect.stringMatching(/^model-step:/),
    });
    expect(requests[1]?.modelStepId).not.toBe(requests[1]?.stepId);
    expect(repository.listStepsByRun('run-1')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stepId: 'step-1',
        kind: 'model',
        status: 'succeeded',
      }),
      expect.objectContaining({
        stepId: 'step-2',
        kind: 'model',
        status: 'succeeded',
      }),
    ]));
    expect(requests[1]?.toolResults).toEqual([
      expect.objectContaining({ toolResultId: 'tool-result-1' }),
    ]);
    expect(streamed.map((event) => event.eventType)).toEqual([
      'run.started',
      'tool.use.created',
      'model.step.completed',
      'tool.result.created',
      'assistant.output.completed',
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect(streamed.at(-1)?.eventType).toBe('run.completed');
    expect(service.listRuntimeEventsByRun('run-1').map((event) => event.eventType)).toContain('tool.result.created');
    expect(service.listMessagesBySession('session-1').at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Final answer after tool result.',
      runId: 'run-1',
    });
  });

  it('completes session message runs from real adapter model output deltas and model step completion', async () => {
    const service = createServiceWithModelStepStream([
      {
        eventId: 'event-model-step-started',
        schemaVersion: 1,
        eventType: 'model.step.started',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        sequence: 1,
        createdAt: '2026-05-17T00:00:01.000Z',
        source: 'provider',
        visibility: 'system',
        persist: 'required',
        payload: {
          modelStepId: 'model-step-1',
          providerId: 'openai',
          modelId: 'gpt-5.5',
        },
      },
      modelOutputDeltaEvent({ sequence: 2, delta: 'Hello ' }),
      modelOutputDeltaEvent({ sequence: 3, delta: 'Megumi.' }),
      {
        ...modelStepCompletedEvent(4),
        payload: {
          modelStepId: 'model-step-1',
          finishReason: 'stop',
        },
      },
    ]);
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-5.5',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Hello',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    const streamed = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(streamed.map((event) => event.eventType)).toEqual([
      'run.started',
      'model.step.started',
      'model.output.delta',
      'model.output.delta',
      'model.step.completed',
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect(service.listMessagesBySession('session-1')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: 'Hello Megumi.',
        runId: 'run-1',
      }),
    ]));
  });

  it('keeps session message runs open when the tool loop stops for pending approval', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    db = new Database(':memory:');
    migrateDatabase(db);
    const repository = new SessionRunRepository(db);
    const service = new SessionRunService({
      repository,
      modelStepProvider: {
        streamModelStep: async function* (request) {
          requests.push(request);
          yield toolUseCreatedEvent(1);
          yield modelStepCompletedEvent(2);
        },
        cancelModelStep: () => true,
      },
      toolUseHandler: {
        async handleToolUses(input) {
          const toolUse = input.toolUses[0];
          if (!toolUse) {
            throw new Error('Expected one tool use.');
          }

          const toolCall: ToolCall = {
            toolCallId: 'tool-call-1',
            toolUseId: toolUse.toolUseId,
            runId: toolUse.runId,
            stepId: 'step-1',
            toolName: toolUse.toolName,
            input: toolUse.input,
            inputPreview: toolUse.inputPreview,
            capabilities: ['project_read'],
            riskLevel: 'low',
            sideEffect: 'none',
            status: 'waiting_for_approval',
            requestedAt: '2026-05-17T00:00:02.250Z',
          };
          const approvalRequest: ApprovalRequest = {
            approvalRequestId: 'approval-request-1',
            toolUseId: toolUse.toolUseId,
            toolCallId: toolCall.toolCallId,
            runId: toolUse.runId,
            stepId: toolCall.stepId,
            toolName: toolUse.toolName,
            capabilities: toolCall.capabilities,
            riskLevel: toolCall.riskLevel,
            title: 'Approve read_file',
            summary: 'User approval is required.',
            preview: {
              action: 'read_file',
              targets: [{
                kind: 'file',
                label: 'package.json',
                sensitivity: 'normal',
              }],
            },
            requestedScope: 'once',
            status: 'pending',
            createdAt: '2026-05-17T00:00:02.300Z',
          };

          return {
            toolResults: [],
            pendingApprovals: [{
              approvalRequest,
              toolUse,
              toolCall,
            }],
          };
        },
      },
      clock: { now: () => '2026-05-17T00:00:04.000Z' },
      ids: {
        sessionId: () => 'session-1',
        runId: () => 'run-1',
        stepId: () => 'step-1',
        eventId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `service-event-${index}`;
          };
        })(),
        messageId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `message-${index}`;
          };
        })(),
      },
    });
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Read package.json',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    const streamed = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(requests).toHaveLength(1);
    expect(streamed.map((event) => event.eventType)).toEqual([
      'run.started',
      'tool.use.created',
      'model.step.completed',
    ]);
    expect(streamed.map((event) => event.eventType)).not.toContain('run.completed');
    expect(repository.getRun('run-1')).toMatchObject({
      status: 'running',
    });
    expect(service.listMessagesBySession('session-1')).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Read package.json',
      }),
    ]);
  });

  it('passes workspace baseline context to model step requests for session messages', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const baselineInputs: unknown[] = [];
    const service = createServiceWithModelStepStream([], {
      contextService: {
        createBaselineContext: (input) => {
          baselineInputs.push(input);
          return {
            contextId: `context:${input.runId}`,
            runId: input.runId,
            workspaceBoundary: {
              workspaceId: input.workspaceId,
              rootPath: input.workspacePath,
              symlinkPolicy: 'deny_outside_workspace',
              outsideWorkspacePolicy: 'deny',
              secretPolicySummary: 'No secrets.',
              createdAt: '2026-05-17T00:00:00.000Z',
            },
            goal: input.goal,
            constraints: [],
            inlineContents: [],
            resourceRefs: [],
            conversationRefs: [],
            messageSummaries: [],
            workspaceSources: [],
            toolObservationRefs: [],
            memoryRecallRefs: [],
            policySummary: {
              workspaceAccess: 'workspace-read',
              restrictedResources: [],
              approvalSummary: 'No approval.',
              sandboxSummary: 'Read-only.',
            },
            modelCapabilitySummary: input.modelCapabilitySummary,
            budget: {
              modelContextWindow: input.modelCapabilitySummary.modelContextWindow,
              reservedOutputTokens: input.modelCapabilitySummary.reservedOutputTokens,
              availableInputTokens: input.modelCapabilitySummary.availableInputTokens,
              budgetPolicy: 'balanced',
              packingStrategy: 'priority_then_recent',
              truncationRecords: [],
            },
            buildMetadata: {
              buildReason: 'run_baseline',
              builtAt: '2026-05-17T00:00:00.000Z',
              selectionRecordIds: [],
              redactionRecordIds: [],
              truncationRecordIds: [],
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          } satisfies RunContext;
        },
      },
      onRequest: (request) => requests.push(request),
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Use workspace context',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/all/work/study/megumi',
          sessionTitle: 'Workspace session',
          composerMode: 'execute',
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });

    for await (const _event of result.events) {
      // Drain the stream so the provider request is observed.
    }

    expect(baselineInputs).toEqual([
      expect.objectContaining({
        runId: 'run-1',
        goal: 'Use workspace context',
        workspaceId: 'workspace-1',
        workspacePath: 'C:/all/work/study/megumi',
      }),
    ]);
    expect(requests).toEqual([
      expect.objectContaining({
        context: expect.objectContaining({
          runId: 'run-1',
          goal: 'Use workspace context',
          workspaceBoundary: expect.objectContaining({
            workspaceId: 'workspace-1',
            rootPath: 'C:/all/work/study/megumi',
          }),
        }),
      }),
    ]);
  });

  it('creates run mode snapshots and passes them to model step requests for session messages', async () => {
    const records: unknown[] = [];
    const requests: ModelStepRuntimeRequest[] = [];
    const service = createServiceWithModelStepStream([], {
      runModeService: {
        createModeSnapshot: (input) => {
          records.push(input);
          return {
            modeSnapshotId: 'mode-snapshot:1',
            runId: input.runId,
            modeLabel: input.mode,
            mode: input.modeSnapshot ?? RUN_MODE_PRESET_DEFAULTS.plan,
            createdAt: input.createdAt,
          };
        },
        linkAcceptedSourcePlan: (input) => input,
        createPlanRecordForRun: () => undefined,
        getPlanByRun: () => undefined,
        updatePlanStatus: () => {
          throw new Error('not implemented');
        },
      },
      onRequest: (request) => requests.push(request),
    });
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Write a plan',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        context: {
          composerMode: 'plan',
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });

    for await (const _event of result.events) {
      // Drain the stream so the provider request is observed.
    }

    expect(records).toEqual([
      expect.objectContaining({
        runId: 'run-1',
        mode: 'plan',
        createdAt: '2026-05-17T00:00:00.000Z',
      }),
    ]);
    expect(requests).toEqual([
      expect.objectContaining({
        modeSnapshot: {
          permissionMode: 'plan',
          source: 'system',
          createdAt: '2026-05-17T00:00:00.000Z',
        },
        modeSnapshotRef: 'mode-snapshot:1',
      }),
    ]);
  });

  it('saves session message run mode snapshots with the real run mode repository', async () => {
    db = new Database(':memory:');
    migrateDatabase(db);
    const requests: ModelStepRuntimeRequest[] = [];
    const sessionRepository = new SessionRunRepository(db);
    const service = new SessionRunService({
      repository: sessionRepository,
      runModeService: new RunModeService({
        repository: new RunModeRepository(db),
        ids: {
          modeSnapshotId: () => 'mode-snapshot:real-repo',
          planArtifactId: () => 'plan:real-repo',
        },
      }),
      modelStepProvider: {
        streamModelStep: async function* (request) {
          requests.push(request);
        },
        cancelModelStep: () => true,
      },
      clock: { now: () => '2026-05-17T00:00:00.000Z' },
      ids: {
        sessionId: () => 'session-1',
        runId: () => 'run-1',
        stepId: () => 'step-1',
        messageId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `message-${index}`;
          };
        })(),
      },
    });

    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Write a plan',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        context: {
          composerMode: 'plan',
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });

    for await (const _event of result.events) {
      // Drain the stream so the provider request is observed.
    }

    expect(requests).toEqual([
      expect.objectContaining({
        modeSnapshotRef: 'mode-snapshot:real-repo',
        modeSnapshot: {
          permissionMode: 'plan',
          source: 'system',
          createdAt: '2026-05-17T00:00:00.000Z',
        },
      }),
    ]);
    expect(sessionRepository.getRun('run-1')).toMatchObject({
      modeSnapshotRef: 'mode-snapshot:real-repo',
    });
  });

  it('adds request metadata to session message runtime events', async () => {
    const service = createServiceWithModelStepStream([
      {
        eventId: 'event-assistant-delta',
        schemaVersion: 1,
        eventType: 'assistant.output.delta',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        sequence: 1,
        createdAt: '2026-05-17T00:00:01.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'transient',
        payload: { delta: 'Hello' },
      },
      {
        eventId: 'event-assistant-completed',
        schemaVersion: 1,
        eventType: 'assistant.output.completed',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        sequence: 2,
        createdAt: '2026-05-17T00:00:02.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'required',
        payload: { content: 'Hello' },
      },
    ]);
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Hello',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      runtimeContext: {
        requestId: 'ipc-session-message-send-1',
        traceId: 'trace-ipc-session-message-send-1',
        debugId: 'debug-ipc-session-message-send-1',
        operationName: 'session.message.send',
        source: 'renderer',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    const streamed = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(streamed).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'run.completed',
        requestId: 'ipc-session-message-send-1',
        context: expect.objectContaining({
          operationName: 'session.message.send',
        }),
      }),
    ]));
    expect(streamed.every((event) => event.requestId === 'ipc-session-message-send-1')).toBe(true);
  });

  it('does not mark a session message run completed after provider failure', async () => {
    const service = createServiceWithModelStepStream([
      {
        eventId: 'event-run-failed',
        schemaVersion: 1,
        eventType: 'run.failed',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        sequence: 1,
        createdAt: '2026-05-17T00:00:01.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'required',
        payload: {
          error: {
            code: 'provider_auth_failed',
            message: 'Provider failed.',
            severity: 'error',
            retryable: false,
            source: 'provider',
          },
        },
      },
    ]);
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Hello',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    const streamed = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(streamed.map((event) => event.eventType)).toEqual([
      'run.started',
      'run.failed',
      'step.status.changed',
      'step.failed',
      'run.status.changed',
    ]);
    expect(streamed.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(service.listRuntimeEventsByRun('run-1').map((event) => event.eventType)).toEqual([
      'run.started',
      'run.failed',
      'step.status.changed',
      'step.failed',
      'run.status.changed',
    ]);
  });
});
