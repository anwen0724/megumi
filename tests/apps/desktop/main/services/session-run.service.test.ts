// @vitest-environment node
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { SessionRunRepository } from '@megumi/db/repos/session-run.repo';
import { RunModeRepository } from '@megumi/db/repos/run-mode.repo';
import { ToolRepository } from '@megumi/db/repos/tool.repo';
import {
  SessionRunService,
  type SessionRunContextService,
  type SessionRunServiceOptions,
} from '@megumi/desktop/main/services/session-run.service';
import { RunModeService } from '@megumi/desktop/main/services/run-mode.service';
import type { ChatStreamEvent } from '@megumi/shared';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { RunContext } from '@megumi/shared/run-context-contracts';
import type { RunAction } from '@megumi/shared/session-run-contracts';
import type { ApprovalRequest, ToolDefinition, ToolExecution, ToolResult } from '@megumi/shared/tool-contracts';
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
          contextBudgetPolicy: input.contextBudgetPolicy,
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
          mode: input.modeSnapshot ?? {
            permissionMode: 'default',
            source: 'system',
          },
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
          mode: input.modeSnapshot ?? {
            permissionMode: 'plan',
            source: 'system',
          },
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

function createServiceWithModelStepStream(
  events: RuntimeEvent[] | ((request: ModelStepRuntimeRequest, callIndex: number) => RuntimeEvent[]),
  options?: {
  contextService?: SessionRunContextService;
  runModeService?: SessionRunServiceOptions['runModeService'];
  toolRuntimeFactory?: SessionRunServiceOptions['toolRuntimeFactory'];
  toolDefinitionProvider?: SessionRunServiceOptions['toolDefinitionProvider'];
  timelineMessageRepository?: SessionRunServiceOptions['timelineMessageRepository'];
  agentInstructionSourceService?: SessionRunServiceOptions['agentInstructionSourceService'];
  sessionContextInputService?: SessionRunServiceOptions['sessionContextInputService'];
  onRequest?: (request: ModelStepRuntimeRequest) => void;
}) {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new SessionRunRepository(db);
  let callIndex = 0;
  return new SessionRunService({
    repository,
    ...(options?.contextService ? { contextService: options.contextService } : {}),
    ...(options?.runModeService ? { runModeService: options.runModeService } : {}),
    ...(options?.toolRuntimeFactory ? { toolRuntimeFactory: options.toolRuntimeFactory } : {}),
    ...(options?.toolDefinitionProvider ? { toolDefinitionProvider: options.toolDefinitionProvider } : {}),
    ...(options?.timelineMessageRepository ? { timelineMessageRepository: options.timelineMessageRepository } : {}),
    ...(options?.agentInstructionSourceService ? { agentInstructionSourceService: options.agentInstructionSourceService } : {}),
    ...(options?.sessionContextInputService ? { sessionContextInputService: options.sessionContextInputService } : {}),
    modelStepProvider: {
      streamModelStep: async function* (request) {
        callIndex += 1;
        options?.onRequest?.(request);
        yield* (typeof events === 'function' ? events(request, callIndex) : events);
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

function createServiceWithChatStreamSink(
  events: RuntimeEvent[] | ((request: ModelStepRuntimeRequest, callIndex: number) => RuntimeEvent[]),
  chatEvents: ChatStreamEvent[],
  options?: {
    toolRuntimeFactory?: SessionRunServiceOptions['toolRuntimeFactory'];
    toolDefinitionProvider?: SessionRunServiceOptions['toolDefinitionProvider'];
  },
) {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new SessionRunRepository(db);
  let callIndex = 0;
  return new SessionRunService({
    repository,
    ...(options?.toolRuntimeFactory ? { toolRuntimeFactory: options.toolRuntimeFactory } : {}),
    ...(options?.toolDefinitionProvider ? { toolDefinitionProvider: options.toolDefinitionProvider } : {}),
    modelStepProvider: {
      streamModelStep: async function* (request) {
        callIndex += 1;
        yield* (typeof events === 'function' ? events(request, callIndex) : events);
      },
      cancelModelStep: () => true,
    },
    chatStreamEventSink: {
      publish: (event) => chatEvents.push(event),
    },
    clock: { now: () => '2026-05-24T00:00:00.000Z' },
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
          return `event-${index}`;
        };
      })(),
      messageId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `message-${index}`;
        };
      })(),
      chatStreamEventId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `chat-stream-event-${index}`;
        };
      })(),
      chatStreamId: () => 'stream-main-1',
      chatTextId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `text-${index}`;
        };
      })(),
      chatThinkingId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `thinking-${index}`;
        };
      })(),
    },
  });
}

function createServiceWithChatStreamSinkAndRepository(
  events: RuntimeEvent[] | ((request: ModelStepRuntimeRequest, callIndex: number) => RuntimeEvent[]),
  chatEvents: ChatStreamEvent[],
  options?: Parameters<typeof createServiceWithChatStreamSink>[2],
) {
  const service = createServiceWithChatStreamSink(events, chatEvents, options);
  if (!db) {
    throw new Error('Expected test database to be initialized.');
  }
  return {
    service,
    repository: new SessionRunRepository(db),
  };
}

function toolUseCreatedEvent(sequence: number): RuntimeEvent {
  return toolUseCreatedEventFor({
    sequence,
    toolCallId: 'tool-call-1',
    providerToolCallId: 'provider-tool-call-1',
    input: { path: 'package.json' },
  });
}

function toolUseCreatedEventFor(input: {
  sequence: number;
  toolCallId: string;
  providerToolCallId: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  input?: Record<string, unknown>;
}): RuntimeEvent {
  return {
    eventId: `event-tool-call-${input.sequence}`,
    schemaVersion: 1,
    eventType: 'tool.call.created',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    sequence: input.sequence,
    createdAt: '2026-05-17T00:00:01.000Z',
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: {
      toolCallId: input.toolCallId,
      modelStepId: 'model-step-1',
      providerToolCallId: input.providerToolCallId,
      toolName: input.toolName ?? 'read_file',
      input: input.input ?? input.toolInput ?? { path: 'package.json' },
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

function modelStepProviderStateRecordedEvent(sequence: number): RuntimeEvent {
  return {
    eventId: `event-model-step-provider-state-${sequence}`,
    schemaVersion: 1,
    eventType: 'model.step.provider_state.recorded',
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
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      blocks: [{
        type: 'reasoning_content',
        text: 'Need to read package.json before answering.',
      }],
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

function toolCallRequestedRuntimeEvent(): RuntimeEvent {
  return {
    eventId: 'event-tool-call-requested',
    schemaVersion: 1,
    eventType: 'tool.execution.requested',
    runId: 'run-1',
    sessionId: 'session-1',
    stepId: 'step-1',
    sequence: 1,
    createdAt: '2026-05-20T00:00:01.000Z',
    source: 'tool',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolExecution: {
        toolExecutionId: 'tool-execution-1',
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        stepId: 'step-1',
        toolName: 'read_file',
        input: { path: 'package.json' },
        inputPreview: {
          summary: 'read_file',
          targets: [],
          redactionState: 'none',
        },
        capabilities: ['project_read'],
        riskLevel: 'low',
        sideEffect: 'none',
        status: 'running',
        requestedAt: '2026-05-20T00:00:01.000Z',
      },
    },
  };
}

function approvalResumeRuntimeEvents(toolResult: ToolResult, status: 'success' | 'failure' | 'denied'): RuntimeEvent[] {
  const toolCallId = String(toolResult.toolCallId ?? 'tool-call-1');
  const toolExecutionId = String(toolResult.toolExecutionId ?? 'tool-execution-1');
  const started: RuntimeEvent = {
    eventId: `event-${toolExecutionId}-started`,
    schemaVersion: 1,
    eventType: 'tool.execution.started',
    runId: 'run-1',
    sessionId: 'session-1',
    stepId: 'step-1',
    sequence: 1,
    createdAt: '2026-05-17T00:00:05.000Z',
    source: 'tool',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolExecutionId,
      startedAt: '2026-05-17T00:00:05.000Z',
    },
  };
  const terminal: RuntimeEvent = status === 'denied'
    ? {
        eventId: `event-${toolExecutionId}-denied`,
        schemaVersion: 1,
        eventType: 'tool.execution.denied',
        runId: 'run-1',
        sessionId: 'session-1',
        stepId: 'step-1',
        sequence: 2,
        createdAt: toolResult.createdAt,
        source: 'security',
        visibility: 'user',
        persist: 'required',
        payload: {
          toolExecutionId,
          reason: toolResult.denialReason ?? 'User rejected the requested tool call.',
        },
      }
    : status === 'failure'
      ? {
          eventId: `event-${toolExecutionId}-failed`,
          schemaVersion: 1,
          eventType: 'tool.execution.failed',
          runId: 'run-1',
          sessionId: 'session-1',
          stepId: 'step-1',
          sequence: 2,
          createdAt: toolResult.createdAt,
          source: 'tool',
          visibility: 'user',
          persist: 'required',
          payload: {
            toolExecutionId,
            error: toolResult.error ?? {
              code: 'runtime_unknown',
              message: 'Tool failed.',
              severity: 'error',
              retryable: false,
              source: 'tool',
            },
            completedAt: toolResult.createdAt,
          },
        }
      : {
          eventId: `event-${toolExecutionId}-completed`,
          schemaVersion: 1,
          eventType: 'tool.execution.completed',
          runId: 'run-1',
          sessionId: 'session-1',
          stepId: 'step-1',
          sequence: 2,
          createdAt: toolResult.createdAt,
          source: 'tool',
          visibility: 'user',
          persist: 'required',
          payload: {
            toolExecutionId,
            completedAt: toolResult.createdAt,
          },
        };
  const result: RuntimeEvent = {
    eventId: `event-${toolResult.toolResultId}-created`,
    schemaVersion: 1,
    eventType: 'tool.result.created',
    runId: 'run-1',
    sessionId: 'session-1',
    stepId: 'step-1',
    sequence: 3,
    createdAt: toolResult.createdAt,
    source: 'tool',
    visibility: 'system',
    persist: 'required',
    payload: {
      toolResultId: String(toolResult.toolResultId),
      toolCallId,
      ...(toolResult.toolExecutionId ? { toolExecutionId: String(toolResult.toolExecutionId) } : {}),
      kind: toolResult.kind,
      summary: toolResult.textContent ?? toolResult.denialReason ?? toolResult.kind,
    },
  };

  return status === 'denied' ? [terminal, result] : [started, terminal, result];
}

function createToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    toolResultId: 'tool-result-1',
    toolCallId: 'tool-call-1',
    runId: 'run-1',
    kind: 'success',
    structuredContent: { text: 'package contents' },
    textContent: 'package contents',
    redactionState: 'none',
    createdAt: '2026-05-17T00:00:02.500Z',
    ...overrides,
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
      mode: 'default',
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
      mode: 'default',
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
      mode: 'default',
      modeSnapshot: {
        permissionMode: 'default',
        source: 'user',
      },
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
      modeSnapshot: {
        permissionMode: 'plan',
        source: 'user',
      },
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(result.run.status).toBe('failed');
    expect(records).toEqual([
      expect.objectContaining({ type: 'snapshot' }),
    ]);
  });

  it('sends a session message by persisting user message, run, and model step', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
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
    ], {
      onRequest: (request) => requests.push(request),
    });
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const longRequestId = `ipc-${'a'.repeat(124)}`;
    const result = await service.sendSessionMessage({
      requestId: longRequestId,
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

    expect(result.data).toEqual({ requestId: longRequestId });
    expect(requests[0]?.inputContext.contextId.length).toBeLessThanOrEqual(128);
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
      requestId: longRequestId,
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 1,
    });
    expect(streamed.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(service.listRuntimeEventsByRun('run-1').map((event) => event.eventType)).toContain('assistant.output.completed');
    expect(service.listMessagesBySession('session-1')).toEqual([
      expect.objectContaining({ role: 'user', content: 'Hello', runId: 'run-1' }),
    ]);
  });

  it('passes available project tool definitions to the provider request when a session has a workspace', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const toolDefinitions: ToolDefinition[] = [{
      name: 'list_directory',
      title: 'List directory',
      description: 'List files in a project directory.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      availability: { status: 'available' },
    }];
    const service = createServiceWithModelStepStream([
      assistantOutputCompletedEvent(1),
    ], {
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls() {
              return { toolResults: [], runtimeEvents: [] };
            },
            async resumeToolApproval() {
              return undefined;
            },
          };
        },
      },
      toolDefinitionProvider: {
        listDefinitions(input) {
          expect(input).toEqual({
            runId: 'run-1',
            permissionMode: 'default',
            providerCapabilitySummary: { supportsToolCall: true },
          });
          return toolDefinitions;
        },
      },
      onRequest: (request) => requests.push(request),
    });
    service.createSession({
      title: 'Session',
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const longRequestId = `ipc-${'b'.repeat(124)}`;
    const result = await service.sendSessionMessage({
      requestId: longRequestId,
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'List docs files',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    for await (const _event of result.events) {
      // drain stream
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]?.inputContext.contextId.length).toBeLessThanOrEqual(128);
    expect(requests[0]?.toolDefinitions).toEqual(toolDefinitions);
  });

  it('builds session message model input from persisted SessionContextInput', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    db = new Database(':memory:');
    migrateDatabase(db);
    const repository = new SessionRunRepository(db);
    const service = new SessionRunService({
      repository,
      modelStepProvider: {
        streamModelStep: async function* (request) {
          requests.push(request);
          yield assistantOutputCompletedEvent(1);
        },
        cancelModelStep: () => true,
      },
      clock: { now: () => '2026-05-28T00:01:00.000Z' },
      ids: {
        sessionId: () => 'session-1',
        runId: () => 'run-current',
        stepId: () => 'step-current',
        messageId: () => 'message-current',
      },
    });

    repository.saveSession({
      sessionId: 'session-1',
      title: 'Session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/all/work/study/megumi',
      status: 'active',
      summary: 'Session summary should be injected as session_summary.',
      createdAt: '2026-05-28T00:00:00.000Z',
      updatedAt: '2026-05-28T00:00:00.000Z',
    });
    repository.saveMessage({
      messageId: 'message-prev-user',
      sessionId: 'session-1',
      runId: 'run-prev',
      role: 'user',
      content: 'Previous persisted user message.',
      status: 'completed',
      createdAt: '2026-05-28T00:00:01.000Z',
      completedAt: '2026-05-28T00:00:01.000Z',
    });
    repository.saveMessage({
      messageId: 'message-prev-assistant',
      sessionId: 'session-1',
      runId: 'run-prev',
      role: 'assistant',
      content: 'Previous persisted assistant answer.',
      status: 'completed',
      createdAt: '2026-05-28T00:00:02.000Z',
      completedAt: '2026-05-28T00:00:02.000Z',
    });
    repository.saveRun({
      runId: 'run-prev',
      sessionId: 'session-1',
      mode: 'default',
      goal: 'Previous turn',
      status: 'failed',
      createdAt: '2026-05-28T00:00:03.000Z',
      error: {
        code: 'runtime_unknown',
        message: 'Previous provider failure.',
        severity: 'error',
        retryable: false,
        source: 'provider',
      },
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [
          {
            id: 'renderer-history-should-not-be-used',
            role: 'assistant',
            content: 'Renderer-only timeline text must not enter model input.',
            createdAt: '2026-05-28T00:00:30.000Z',
          },
          {
            id: 'message-local-user',
            role: 'user',
            content: 'Continue from persisted context.',
            createdAt: '2026-05-28T00:01:00.000Z',
          },
        ],
        createdAt: '2026-05-28T00:01:00.000Z',
      },
    });
    for await (const _event of result.events) {
      // drain stream
    }

    expect(requests[0]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'session',
        sessionKind: 'session_summary',
        text: 'Session summary should be injected as session_summary.',
      }),
      expect.objectContaining({
        kind: 'session',
        sessionKind: 'session_history',
        text: '[user] Previous persisted user message.',
      }),
      expect.objectContaining({
        kind: 'session',
        sessionKind: 'session_history',
        text: '[assistant] Previous persisted assistant answer.',
      }),
      expect.objectContaining({
        kind: 'session',
        sessionKind: 'session_runtime_fact',
        text: '[run_failed] Previous run failed before a final answer. Error: Previous provider failure.',
      }),
      expect.objectContaining({
        kind: 'current_turn',
        role: 'user',
        text: 'Continue from persisted context.',
      }),
    ]));
    expect(JSON.stringify(requests[0]?.inputContext.parts)).not.toContain('Renderer-only timeline text');
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
      toolRuntimeFactory: {
        async create(input) {
          expect(input).toEqual({
            projectRoot: 'C:/all/work/study/megumi',
            permissionMode: 'default',
          });
          return {
            async handleToolCalls() {
              return {
                toolResults: [toolResult],
                runtimeEvents: [toolCallRequestedRuntimeEvent()],
              };
            },
            async resumeToolApproval() {
              return undefined;
            },
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
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const toolContinuationLongRequestId = `ipc-${'d'.repeat(124)}`;
    const result = await service.sendSessionMessage({
      requestId: toolContinuationLongRequestId,
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
    expect(requests[1]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_continuation',
        toolResultId: 'tool-result-1',
      }),
    ]));
    expect(streamed.map((event) => event.eventType)).toEqual([
      'run.started',
      'tool.call.created',
      'model.step.completed',
      'tool.execution.requested',
      'tool.result.created',
      'assistant.output.completed',
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect(streamed.at(-1)?.eventType).toBe('run.completed');
    expect(service.listRuntimeEventsByRun('run-1').map((event) => event.eventType)).toContain('tool.result.created');
    expect(service.listMessagesBySession('session-1')).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Read package.json',
        runId: 'run-1',
      }),
    ]);
  });

  it('persists model step records before tool handlers persist model tool uses', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateDatabase(db);
    const repository = new SessionRunRepository(db);
    const toolRepository = new ToolRepository(db);
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
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls(input) {
              const [toolUse] = input.toolCalls;
              expect(toolUse).toMatchObject({
                toolCallId: 'tool-call-1',
                modelStepId: 'model-step-1',
              });
              toolRepository.saveToolCall(toolUse);
              return {
                toolResults: [createToolResult({ toolCallId: toolUse.toolCallId })],
              };
            },
            async resumeToolApproval() {
              return undefined;
            },
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
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const modelRecordLongRequestId = `ipc-${'e'.repeat(124)}`;
    const result = await service.sendSessionMessage({
      requestId: modelRecordLongRequestId,
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

    expect(toolRepository.listToolCallsByRun('run-1')).toEqual([
      expect.objectContaining({
        toolCallId: 'tool-call-1',
        modelStepId: 'model-step-1',
      }),
    ]);
    expect(streamed.at(-1)?.eventType).toBe('run.completed');
  });

  it('marks session message runs failed when the tool runtime throws after model tool use', async () => {
    const service = createServiceWithModelStepStream([
      toolUseCreatedEvent(1),
      modelStepCompletedEvent(2),
    ], {
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls() {
              throw new Error('tool persistence failed');
            },
            async resumeToolApproval() {
              return undefined;
            },
          };
        },
      },
    });
    service.createSession({
      title: 'Session',
      workspacePath: 'C:/all/work/study/megumi',
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

    expect(streamed.map((event) => event.eventType)).toEqual([
      'run.started',
      'tool.call.created',
      'model.step.completed',
      'run.failed',
      'step.status.changed',
      'step.failed',
      'run.status.changed',
    ]);
    expect(service.listRuntimeEventsByRun('run-1').map((event) => event.eventType)).toEqual([
      'run.started',
      'tool.call.created',
      'model.step.completed',
      'run.failed',
      'step.status.changed',
      'step.failed',
      'run.status.changed',
    ]);
  });

  it('does not emit action.requested for model tool use runs', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const toolResult = createToolResult({
      toolCallId: 'tool-call-1',
    });
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
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls() {
              return {
                toolResults: [toolResult],
                runtimeEvents: [toolCallRequestedRuntimeEvent()],
              };
            },
            async resumeToolApproval() {
              return undefined;
            },
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
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-5.2',
        messages: [{
          id: 'message-input-1',
          role: 'user',
          content: 'Read package.json',
          createdAt: '2026-05-20T00:00:00.000Z',
        }],
        context: {
          sessionTitle: 'Read package.json',
          permissionMode: 'default',
        },
        createdAt: '2026-05-20T00:00:00.000Z',
      },
    });
    const events = [];
    for await (const event of result.events) {
      events.push(event);
    }
    const eventTypes = events.map((event) => event.eventType);

    expect(eventTypes).toContain('tool.call.created');
    expect(eventTypes).toContain('tool.execution.requested');
    expect(eventTypes).toContain('tool.result.created');
    expect(eventTypes).not.toContain('action.requested');
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
      'model.step.completed',
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect(streamed.find((event) => event.eventType === 'model.output.delta')?.payload).toMatchObject({
      delta: 'Hello Megumi.',
    });
    expect(service.listMessagesBySession('session-1')).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Hello',
        runId: 'run-1',
      }),
    ]);
  });

  it('publishes chat stream events through the injected sink while keeping runtime events unchanged', async () => {
    const chatEvents: ChatStreamEvent[] = [];
    const service = createServiceWithChatStreamSink([
      modelOutputDeltaEvent({ sequence: 1, delta: 'Hel' }),
      modelOutputDeltaEvent({ sequence: 2, delta: 'lo' }),
      {
        eventId: 'event-model-step-completed',
        schemaVersion: 1,
        eventType: 'model.step.completed',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        sequence: 3,
        createdAt: '2026-05-24T00:00:01.000Z',
        source: 'provider',
        visibility: 'system',
        persist: 'required',
        payload: { modelStepId: 'model-step-1', finishReason: 'stop' },
      },
    ], chatEvents);
    service.createSession({
      title: 'Session',
      workspaceId: 'project-1',
      createdAt: '2026-05-24T00:00:00.000Z',
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
          createdAt: '2026-05-24T00:00:00.000Z',
        }],
        createdAt: '2026-05-24T00:00:00.000Z',
      },
    });
    const runtimeEvents = [];
    for await (const event of result.events) {
      runtimeEvents.push(event);
    }

    expect(runtimeEvents.map((event) => event.eventType)).toEqual([
      'run.started',
      'model.output.delta',
      'model.step.completed',
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect(runtimeEvents.find((event) => event.eventType === 'model.output.delta')?.payload).toMatchObject({
      delta: 'Hello',
    });
    expect(chatEvents.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'assistant.text.started',
      'assistant.text.delta',
      'assistant.text.completed',
      'turn.completed',
    ]);
    expect(chatEvents.find((event) => event.eventType === 'assistant.text.delta')).toMatchObject({
      delta: 'Hello',
      phase: 'answer',
    });
    expect(chatEvents.every((event) => event.projectId === 'project-1')).toBe(true);
    expect(chatEvents.every((event) => event.streamId === 'stream-main-1')).toBe(true);
    expect(chatEvents.every((event) => event.streamId !== 'run-1')).toBe(true);
    expect(chatEvents.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('publishes terminal chat stream events without saving old flat assistant history', async () => {
    const chatEvents: ChatStreamEvent[] = [];
    const { service, repository } = createServiceWithChatStreamSinkAndRepository([
      {
        eventId: 'event-assistant-completed',
        schemaVersion: 1,
        eventType: 'assistant.output.completed',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        sequence: 1,
        createdAt: '2026-05-24T00:00:01.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'required',
        payload: { content: 'Hello' },
      },
    ], chatEvents);
    service.createSession({
      title: 'Session',
      workspaceId: 'project-1',
      createdAt: '2026-05-24T00:00:00.000Z',
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
          createdAt: '2026-05-24T00:00:00.000Z',
        }],
        createdAt: '2026-05-24T00:00:00.000Z',
      },
    });
    for await (const _event of result.events) {
      // Drain the stream so terminal chat events are published.
    }

    expect(chatEvents.map((event) => event.eventType)).toContain('turn.completed');
    expect(repository.listMessagesBySession('session-1')).toEqual([
      expect.objectContaining({ role: 'user', content: 'Hello', runId: 'run-1' }),
    ]);
  });

  it('keeps the same chat stream across approval resume', async () => {
    const chatEvents: ChatStreamEvent[] = [];
    const toolResult = createToolResult({
      toolCallId: 'tool-use-1',
      kind: 'success',
      textContent: 'Wrote src/app.ts',
    });
    let resumeCalled = false;
    const service = createServiceWithChatStreamSink((_request, callIndex) => {
      if (callIndex === 1) {
        return [
          {
            ...toolUseCreatedEventFor({
              sequence: 1,
              toolCallId: 'tool-use-1',
              providerToolCallId: 'provider-tool-use-1',
              toolName: 'write_file',
              input: { path: 'src/app.ts' },
            }),
            createdAt: '2026-05-24T00:00:00.000Z',
          },
          {
            ...modelStepCompletedEvent(2),
            createdAt: '2026-05-24T00:00:00.000Z',
          },
        ];
      }

      return [
        {
          ...assistantOutputCompletedEvent(1),
          stepId: `step-${callIndex}`,
          createdAt: '2026-05-24T00:00:03.000Z',
        },
      ];
    }, chatEvents, {
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls(input) {
              const toolUse = input.toolCalls[0];
              if (!toolUse) {
                throw new Error('Expected one tool use.');
              }
              const toolExecution: ToolExecution = {
                toolExecutionId: 'tool-execution-1',
                toolCallId: toolUse.toolCallId,
                runId: toolUse.runId,
                stepId: 'step-1',
                toolName: toolUse.toolName,
                input: toolUse.input,
                inputPreview: toolUse.inputPreview,
                capabilities: ['project_write'],
                riskLevel: 'medium',
                sideEffect: 'project_file_operation',
                status: 'pending_approval',
                requestedAt: '2026-05-24T00:00:00.000Z',
              };
              const approvalRequest: ApprovalRequest = {
                approvalRequestId: 'approval-request-1',
                toolCallId: toolUse.toolCallId,
                toolExecutionId: toolExecution.toolExecutionId,
                runId: toolUse.runId,
                stepId: toolExecution.stepId,
                toolName: toolUse.toolName,
                capabilities: toolExecution.capabilities,
                riskLevel: toolExecution.riskLevel,
                title: 'Approve write_file',
                summary: 'Writing project file requires approval.',
                preview: { action: 'write_file', targets: [] },
                requestedScope: 'project',
                status: 'pending',
                createdAt: '2026-05-24T00:00:00.000Z',
              };

              return {
                toolResults: [],
                pendingApprovals: [{
                  approvalRequest,
                  toolCall: toolUse,
                  toolExecution,
                }],
                runtimeEvents: [{
                  eventId: 'event-approval-requested',
                  schemaVersion: 1,
                  eventType: 'approval.requested',
                  runId: 'run-1',
                  sessionId: 'session-1',
                  stepId: 'step-1',
                  sequence: 3,
                  createdAt: '2026-05-24T00:00:00.000Z',
                  source: 'approval',
                  visibility: 'user',
                  persist: 'required',
                  payload: { approvalRequest },
                }],
              };
            },
            async resumeToolApproval() {
              resumeCalled = true;
              return { toolResult };
            },
          };
        },
      },
      toolDefinitionProvider: {
        listDefinitions: () => [{
          name: 'write_file',
          description: 'Write project file.',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
            additionalProperties: true,
          },
          capabilities: ['project_write'],
          riskLevel: 'medium',
          sideEffect: 'project_file_operation',
          availability: { status: 'available' },
        }],
      },
    });
    service.createSession({
      title: 'Session',
      workspaceId: 'project-1',
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-24T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        context: { permissionMode: 'default' },
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Write a file',
          createdAt: '2026-05-24T00:00:00.000Z',
        }],
        createdAt: '2026-05-24T00:00:00.000Z',
      },
    });
    for await (const _event of result.events) {
      // Drain initial run until waiting for approval.
    }
    const beforeResumeCount = chatEvents.length;

    const resumeEvents = service.resumeApproval({
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      decidedAt: '2026-05-24T00:00:02.000Z',
    });
    expect(resumeEvents).toBeDefined();
    for await (const _event of resumeEvents ?? []) {
      // Drain resumed run.
    }

    expect(resumeCalled).toBe(true);
    expect(chatEvents.filter((event) => event.eventType === 'turn.started')).toHaveLength(1);
    expect(new Set(chatEvents.map((event) => event.streamId))).toEqual(new Set(['stream-main-1']));
    expect(chatEvents.map((event) => event.seq)).toEqual(chatEvents.map((_, index) => index + 1));
    expect(chatEvents.slice(beforeResumeCount).map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'approval.resolved',
      'tool.completed',
    ]));
    expect(chatEvents.at(-1)?.eventType).toBe('turn.completed');
  });

  it('marks session message runs waiting and resumes live continuation after approval resolution', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const resumeInputs: unknown[] = [];
    const toolResult = createToolResult();
    db = new Database(':memory:');
    migrateDatabase(db);
    const repository = new SessionRunRepository(db);
    const service = new SessionRunService({
      repository,
      modelStepProvider: {
        streamModelStep: async function* (request) {
          requests.push(request);
          if (requests.length === 1) {
            yield toolUseCreatedEvent(1);
            yield modelStepProviderStateRecordedEvent(2);
            yield modelStepCompletedEvent(3);
            return;
          }
          yield {
            ...assistantOutputCompletedEvent(1),
            stepId: request.stepId,
          };
        },
        cancelModelStep: () => true,
      },
      toolRuntimeFactory: {
        async create(input) {
          expect(input).toEqual({
            projectRoot: 'C:/all/work/study/megumi',
            permissionMode: 'plan',
          });

          return {
            async handleToolCalls(handleInput) {
              const toolUse = handleInput.toolCalls[0];
              if (!toolUse) {
                throw new Error('Expected one tool use.');
              }

              const toolExecution: ToolExecution = {
                toolExecutionId: 'tool-execution-1',
                toolCallId: toolUse.toolCallId,
                runId: toolUse.runId,
                stepId: 'step-1',
                toolName: toolUse.toolName,
                input: toolUse.input,
                inputPreview: toolUse.inputPreview,
                capabilities: ['project_read'],
                riskLevel: 'low',
                sideEffect: 'none',
                status: 'pending_approval',
                requestedAt: '2026-05-17T00:00:02.250Z',
              };
              const approvalRequest: ApprovalRequest = {
                approvalRequestId: 'approval-request-1',
                toolCallId: toolUse.toolCallId,
                toolExecutionId: toolExecution.toolExecutionId,
                runId: toolUse.runId,
                stepId: toolExecution.stepId,
                toolName: toolUse.toolName,
                capabilities: toolExecution.capabilities,
                riskLevel: toolExecution.riskLevel,
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
                  toolCall: toolUse,
                  toolExecution,
                }],
              };
            },
            async resumeToolApproval(input) {
              resumeInputs.push(input);
              return {
                toolResult,
                runtimeEvents: approvalResumeRuntimeEvents(toolResult, 'success'),
              };
            },
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
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const waitingApprovalLongRequestId = `ipc-${'f'.repeat(124)}`;
    const result = await service.sendSessionMessage({
      requestId: waitingApprovalLongRequestId,
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
        context: {
          permissionMode: 'plan',
        },
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
      'tool.call.created',
      'model.step.provider_state.recorded',
      'model.step.completed',
      'run.status.changed',
    ]);
    expect(streamed.map((event) => event.eventType)).not.toContain('run.completed');
    expect(repository.getRun('run-1')).toMatchObject({
      status: 'waiting_for_approval',
    });
    expect(service.listMessagesBySession('session-1')).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Read package.json',
      }),
    ]);

    const resumed = [];
    const resumeEvents = service.resumeApproval({
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      decidedAt: '2026-05-17T00:00:05.000Z',
    });
    expect(resumeEvents).toBeDefined();
    for await (const event of resumeEvents ?? []) {
      resumed.push(event);
    }

    expect(resumeInputs).toEqual([{
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      decidedAt: '2026-05-17T00:00:05.000Z',
    }]);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.inputContext.contextId.length).toBeLessThanOrEqual(128);
    expect(requests[1]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_continuation',
        toolCallId: 'tool-call-1',
        modelStepId: 'model-step-1',
        toolName: 'read_file',
      }),
      expect.objectContaining({
        kind: 'tool_continuation',
        toolResultId: 'tool-result-1',
      }),
      expect.objectContaining({
        kind: 'tool_continuation',
        text: expect.stringContaining('Need to read package.json before answering.'),
      }),
    ]));
    expect(resumed.map((event) => event.eventType)).toEqual([
      'approval.resolved',
      'run.status.changed',
      'tool.execution.started',
      'tool.execution.completed',
      'tool.result.created',
      'assistant.output.completed',
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect([
      ...streamed,
      ...resumed,
    ].filter((event) => event.eventType === 'run.started')).toHaveLength(1);
    expect(resumed.filter((event) => event.eventType === 'tool.result.created')).toHaveLength(1);
    expect(service.listRuntimeEventsByRun('run-1')
      .filter((event) => event.eventType === 'run.started')).toHaveLength(1);
    expect(repository.getRun('run-1')).toMatchObject({
      status: 'completed',
    });
  });

  it('waits for all pending approvals from one model step before resuming once with all tool results', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const resumeInputs: unknown[] = [];
    const toolResultsByApproval = new Map([
      ['approval-request-1', createToolResult({
        toolResultId: 'tool-result-1',
        toolCallId: 'tool-call-1',
        toolExecutionId: 'tool-execution-1',
        textContent: 'first result',
      })],
      ['approval-request-2', createToolResult({
        toolResultId: 'tool-result-2',
        toolCallId: 'tool-call-2',
        toolExecutionId: 'tool-execution-2',
        textContent: 'second result',
      })],
    ]);
    db = new Database(':memory:');
    migrateDatabase(db);
    const repository = new SessionRunRepository(db);
    const service = new SessionRunService({
      repository,
      modelStepProvider: {
        streamModelStep: async function* (request) {
          requests.push(request);
          if (requests.length === 1) {
            yield toolUseCreatedEventFor({
              sequence: 1,
              toolCallId: 'tool-use-1',
              providerToolCallId: 'provider-tool-use-1',
              input: { path: 'package.json' },
            });
            yield toolUseCreatedEventFor({
              sequence: 2,
              toolCallId: 'tool-use-2',
              providerToolCallId: 'provider-tool-use-2',
              input: { path: 'README.md' },
            });
            yield modelStepCompletedEvent(3);
            return;
          }

          yield {
            ...assistantOutputCompletedEvent(1),
            stepId: request.stepId,
          };
        },
        cancelModelStep: () => true,
      },
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls(input) {
              return {
                toolResults: [],
                pendingApprovals: input.toolCalls.map((toolUse, index) => {
                  const ordinal = index + 1;
                  const toolExecution: ToolExecution = {
                    toolExecutionId: `tool-execution-${ordinal}`,
                    toolCallId: toolUse.toolCallId,
                    runId: toolUse.runId,
                    stepId: 'step-1',
                    toolName: toolUse.toolName,
                    input: toolUse.input,
                    inputPreview: toolUse.inputPreview,
                    capabilities: ['project_read'],
                    riskLevel: 'low',
                    sideEffect: 'none',
                    status: 'pending_approval',
                    requestedAt: '2026-05-17T00:00:02.250Z',
                  };
                  const approvalRequest: ApprovalRequest = {
                    approvalRequestId: `approval-request-${ordinal}`,
                    toolCallId: toolUse.toolCallId,
                    toolExecutionId: toolExecution.toolExecutionId,
                    runId: toolUse.runId,
                    stepId: toolExecution.stepId,
                    toolName: toolUse.toolName,
                    capabilities: toolExecution.capabilities,
                    riskLevel: toolExecution.riskLevel,
                    title: `Approve ${toolUse.toolName}`,
                    summary: 'User approval is required.',
                    preview: {
                      action: toolUse.inputPreview.summary,
                      targets: [],
                    },
                    requestedScope: 'once',
                    status: 'pending',
                    createdAt: '2026-05-17T00:00:02.300Z',
                  };

                  return {
                    approvalRequest,
                    toolCall: toolUse,
                    toolExecution,
                  };
                }),
              };
            },
            async resumeToolApproval(input) {
              resumeInputs.push(input);
              const toolResult = toolResultsByApproval.get(input.approvalRequestId);
              return toolResult
                ? {
                    toolResult,
                    runtimeEvents: approvalResumeRuntimeEvents(toolResult, 'success'),
                  }
                : undefined;
            },
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
      workspacePath: 'C:/all/work/study/megumi',
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
          content: 'Read two files',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    const streamed = [];
    for await (const event of result.events) {
      streamed.push(event);
    }
    expect(repository.getRun('run-1')).toMatchObject({ status: 'waiting_for_approval' });

    const firstResume = [];
    for await (const event of service.resumeApproval({
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      decidedAt: '2026-05-17T00:00:05.000Z',
    }) ?? []) {
      firstResume.push(event);
    }

    expect(requests).toHaveLength(1);
    expect(firstResume.map((event) => event.eventType)).toEqual([
      'approval.resolved',
      'tool.execution.started',
      'tool.execution.completed',
      'tool.result.created',
    ]);
    expect(repository.getRun('run-1')).toMatchObject({ status: 'waiting_for_approval' });

    const secondResume = [];
    for await (const event of service.resumeApproval({
      approvalRequestId: 'approval-request-2',
      decision: 'approved',
      decidedAt: '2026-05-17T00:00:06.000Z',
    }) ?? []) {
      secondResume.push(event);
    }

    expect(resumeInputs).toEqual([
      expect.objectContaining({ approvalRequestId: 'approval-request-1' }),
      expect.objectContaining({ approvalRequestId: 'approval-request-2' }),
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_continuation',
        toolResultId: 'tool-result-1',
      }),
      expect.objectContaining({
        kind: 'tool_continuation',
        toolResultId: 'tool-result-2',
      }),
    ]));
    expect(secondResume.map((event) => event.eventType)).toEqual([
      'approval.resolved',
      'run.status.changed',
      'tool.execution.started',
      'tool.execution.completed',
      'tool.result.created',
      'assistant.output.completed',
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect([
      ...streamed,
      ...firstResume,
      ...secondResume,
    ].filter((event) => event.eventType === 'run.started')).toHaveLength(1);
    expect(service.listRuntimeEventsByRun('run-1')
      .filter((event) => event.eventType === 'run.started')).toHaveLength(1);
  });

  it('loads project instructions into the initial model step input context', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const service = createServiceWithModelStepStream([
      assistantOutputCompletedEvent(1),
    ], {
      onRequest: (request) => requests.push(request),
      agentInstructionSourceService: {
        async loadInstructionSources({ projectRoot, loadedAt }) {
          return [{
            sourceId: 'project-instruction:AGENTS.md',
            sourceKind: 'project_instruction',
            status: 'included',
            sourceUri: 'project://AGENTS.md',
            relativePath: 'AGENTS.md',
            text: `# rules for ${projectRoot}`,
            loadedAt,
            sizeBytes: 20,
            includedBytes: 20,
            hardCapBytes: 65536,
            truncated: false,
          }];
        },
      },
    });
    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Continue',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });
    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(streamed.map((event) => event.eventType)).toContain('assistant.output.completed');
    expect(requests[0]?.inputContext.parts[0]).toMatchObject({
      kind: 'instruction',
      instructionKind: 'project',
      text: expect.stringContaining('# rules for C:/project'),
    });
  });

  it('refreshes project instructions for tool continuation model steps', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const service = createServiceWithModelStepStream((request, callIndex) => {
      if (callIndex === 1) {
        return [
          toolUseCreatedEvent(1),
          modelStepCompletedEvent(2),
        ];
      }

      return [{
        ...assistantOutputCompletedEvent(1),
        stepId: request.stepId,
      }];
    }, {
      onRequest: (request) => requests.push(request),
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls() {
              return {
                toolResults: [{
                  toolResultId: 'tool-result-1',
                  toolCallId: 'tool-use-1',
                  runId: 'run-1',
                  kind: 'success',
                  textContent: 'file content',
                  redactionState: 'none',
                  createdAt: '2026-05-17T00:00:01.000Z',
                }],
              };
            },
            async resumeToolApproval() {
              return undefined;
            },
          };
        },
      },
      toolDefinitionProvider: {
        listDefinitions: () => [{
          name: 'read_file',
          title: 'Read file',
          description: 'Read a file.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
          capabilities: ['project_read'],
          riskLevel: 'low',
          sideEffect: 'none',
          availability: { status: 'available' },
        }],
      },
      agentInstructionSourceService: {
        async loadInstructionSources({ loadedAt }) {
          return [{
            sourceId: 'project-instruction:AGENTS.md',
            sourceKind: 'project_instruction',
            status: 'included',
            sourceUri: 'project://AGENTS.md',
            relativePath: 'AGENTS.md',
            text: `# rules loaded at ${loadedAt}`,
            loadedAt,
            sizeBytes: 20,
            includedBytes: 20,
            hardCapBytes: 65536,
            truncated: false,
          }];
        },
      },
    });
    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Read package.json',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });
    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(streamed.map((event) => event.eventType)).toContain('tool.result.created');
    expect(requests).toHaveLength(2);
    expect(requests[1]?.inputContext.parts[0]).toMatchObject({
      kind: 'instruction',
      instructionKind: 'project',
      text: expect.stringContaining('# rules loaded at'),
    });
    expect(requests[1]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tool_continuation' }),
    ]));
  });

  it('registers pending approvals before yielding approval runtime events', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const service = createServiceWithModelStepStream((request, callIndex) => {
      requests.push(request);
      if (callIndex === 1) {
        return [
          toolUseCreatedEvent(1),
          modelStepCompletedEvent(2),
        ];
      }

      return [{
        ...assistantOutputCompletedEvent(1),
        stepId: request.stepId,
      }];
    }, {
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls(input) {
              const toolUse = input.toolCalls[0];
              const toolExecution: ToolExecution = {
                toolExecutionId: 'tool-execution-1',
                toolCallId: toolUse.toolCallId,
                runId: toolUse.runId,
                stepId: 'step-1',
                toolName: toolUse.toolName,
                input: toolUse.input,
                inputPreview: toolUse.inputPreview,
                capabilities: ['project_read'],
                riskLevel: 'low',
                sideEffect: 'none',
                status: 'pending_approval',
                requestedAt: '2026-05-17T00:00:02.250Z',
              };
              const approvalRequest: ApprovalRequest = {
                approvalRequestId: 'approval-request-1',
                toolCallId: toolUse.toolCallId,
                toolExecutionId: toolExecution.toolExecutionId,
                runId: toolUse.runId,
                stepId: toolExecution.stepId,
                toolName: toolUse.toolName,
                capabilities: toolExecution.capabilities,
                riskLevel: toolExecution.riskLevel,
                title: `Approve ${toolUse.toolName}`,
                summary: 'User approval is required.',
                preview: {
                  action: toolUse.inputPreview.summary,
                  targets: [],
                },
                requestedScope: 'once',
                status: 'pending',
                createdAt: '2026-05-17T00:00:02.300Z',
              };

              return {
                pendingApprovals: [{
                  approvalRequest,
                  toolCall: toolUse,
                  toolExecution,
                }],
                runtimeEvents: [{
                  eventId: 'event-approval-requested',
                  schemaVersion: 1,
                  eventType: 'approval.requested',
                  runId: 'run-1',
                  sessionId: 'session-1',
                  stepId: 'step-1',
                  sequence: 3,
                  createdAt: approvalRequest.createdAt,
                  source: 'approval',
                  visibility: 'user',
                  persist: 'required',
                  payload: { approvalRequest },
                }],
              };
            },
            async resumeToolApproval() {
              const toolResult = createToolResult({
                createdAt: '2026-05-17T00:00:05.000Z',
                toolCallId: 'tool-call-1',
              });
              return {
                toolResult,
                runtimeEvents: approvalResumeRuntimeEvents(toolResult, 'success'),
              };
            },
          };
        },
      },
      toolDefinitionProvider: {
        listDefinitions: () => [{
          name: 'read_file',
          title: 'Read file',
          description: 'Read a file.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
          capabilities: ['project_read'],
          riskLevel: 'low',
          sideEffect: 'none',
          availability: { status: 'available' },
        }],
      },
      agentInstructionSourceService: {
        async loadInstructionSources({ loadedAt }) {
          return [{
            sourceId: 'project-instruction:AGENTS.md',
            sourceKind: 'project_instruction',
            status: 'included',
            sourceUri: 'project://AGENTS.md',
            relativePath: 'AGENTS.md',
            text: `# approval rules loaded at ${loadedAt}`,
            loadedAt,
            sizeBytes: 20,
            includedBytes: 20,
            hardCapBytes: 65536,
            truncated: false,
          }];
        },
      },
    });
    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Read package.json',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });
    const iterator = result.events[Symbol.asyncIterator]();
    const initialEvents: RuntimeEvent[] = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        break;
      }
      initialEvents.push(next.value);
      if (next.value.eventType === 'approval.requested') {
        break;
      }
    }

    const resumeEvents = service.resumeApproval({
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      decidedAt: '2026-05-17T00:00:05.000Z',
    });

    expect(initialEvents.map((event) => event.eventType)).toContain('approval.requested');
    expect(resumeEvents).not.toBeUndefined();

    while (!(await iterator.next()).done) {
      // Drain the initial stream after proving immediate resume lookup worked.
    }

    const streamedResumeEvents: RuntimeEvent[] = [];
    for await (const event of resumeEvents ?? []) {
      streamedResumeEvents.push(event);
    }

    expect(streamedResumeEvents.map((event) => event.eventType)).toContain('assistant.output.completed');
    expect(requests[1]?.inputContext.parts[0]).toMatchObject({
      kind: 'instruction',
      instructionKind: 'project',
      text: expect.stringContaining('# approval rules loaded at 2026-05-17T00:00:05.000Z'),
    });
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
            contextBudgetPolicy: input.contextBudgetPolicy,
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
          permissionMode: 'accept_edits',
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
        contextBudgetPolicy: {
          modelContextWindow: 8192,
          reservedOutputTokens: 1024,
          keepRecentTokens: 7168,
        },
      }),
    ]);
    expect(requests[0]).not.toHaveProperty('context');
    expect(requests[0]?.inputContext.budget).toMatchObject({
      modelContextWindow: 8192,
      reservedOutputTokens: 1024,
      availableInputTokens: 7168,
      keepRecentTokens: 7168,
    });
    expect(requests[0]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'runtime_constraint',
        constraintKind: 'project_boundary',
        text: expect.stringContaining('Project root: C:/all/work/study/megumi'),
      }),
    ]));
    const source = fs.readFileSync(path.join(process.cwd(), 'apps/desktop/src/main/services/session-run.service.ts'), 'utf8');
    expect(source).not.toContain('runContext: context');
    expect(source).not.toContain('runContext:');
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
            mode: input.modeSnapshot ?? {
              permissionMode: 'plan',
              source: 'system',
            },
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
          permissionMode: 'plan',
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
    expect(requests[0]).not.toHaveProperty('modeSnapshot');
    expect(requests[0]).not.toHaveProperty('modeSnapshotRef');
    expect(requests[0]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'runtime_constraint',
        constraintKind: 'permission_mode',
        text: expect.stringContaining('Permission mode is'),
      }),
    ]));
  });

  it('saves session message run mode snapshots with the real run mode repository', async () => {
    db = new Database(':memory:');
    migrateDatabase(db);
    const requests: ModelStepRuntimeRequest[] = [];
    const sessionRepository = new SessionRunRepository(db);
    const runModeRepository = new RunModeRepository(db);
    const service = new SessionRunService({
      repository: sessionRepository,
      runModeService: new RunModeService({
        repository: runModeRepository,
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
          permissionMode: 'plan',
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });

    for await (const _event of result.events) {
      // Drain the stream so the provider request is observed.
    }

    expect(requests[0]).not.toHaveProperty('modeSnapshot');
    expect(requests[0]).not.toHaveProperty('modeSnapshotRef');
    expect(sessionRepository.getRun('run-1')).toMatchObject({
      mode: 'plan',
      modeSnapshotRef: 'mode-snapshot:real-repo',
    });
    expect(runModeRepository.getModeSnapshotByRun('run-1')).toMatchObject({
      mode: expect.objectContaining({
        permissionMode: 'plan',
      }),
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
