/*
 * Protects the Engine-to-Agent boundary without preserving the retired Engine loop internals.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Models } from '@megumi/ai';
import type { ContextCapabilities } from '@megumi/context';
import type { EventBus } from '@megumi/events';
import type { Run, RunClock } from '@megumi/engine';
import type { PermissionDecision } from '@megumi/permissions';
import type { SessionEntry, SessionHistory } from '@megumi/session';
import type { Tools } from '@megumi/tools';
import {
  executeAgentRun,
  type EngineAgentRunDependencies,
  type EngineAgentRunInput,
} from '../../../packages/engine/src/agent-adapter';
import {
  assistantStream,
  approvalDecisionFor,
  compactedOverflowCompaction,
  createRunsFixture,
  errorOverflowStream,
  model,
  neverEndingStream,
  runPolicy,
  startRequest,
} from './runs-test-fixtures';
import { permissionService, registeredTool } from './tool-call-test-fixtures';

const NOW = '2026-07-31T00:00:00.000Z';

describe('Engine Agent Adapter', () => {
  it('continues from the already committed User Entry and commits one final reply', async () => {
    const fixture = createRunsFixture({ streams: [assistantStream('done')] });
    const released: string[] = [];
    const modelContexts: unknown[] = [];
    const dependencies = dependenciesFrom(fixture, {
      models: captureModelContexts(fixture.options.models, modelContexts),
      tools: captureReleases(fixture.options.tools, released),
    });

    const result = await executeAgentRun(runInput(), dependencies);

    expect(result).toEqual({ status: 'completed', assistantMessageId: 'message:1' });
    expect(fixture.writes).toEqual(['assistant:completed']);
    expect(fixture.assistantReplies).toHaveLength(1);
    expect(fixture.assistantReplies[0]).toMatchObject({
      parent_entry_id: 'entry:user',
      status: 'completed',
      content: [{ type: 'text', text: 'done' }],
    });
    expect(modelContexts).toHaveLength(1);
    expect(released).toEqual(['model-call:1']);
  });

  it('commits each tool Turn before the next Context scope and preserves the Session Entry chain', async () => {
    const fixture = createRunsFixture({
      streams: [
        assistantStream('using tool', { id: 'call:1', name: 'lookup', arguments: { value: 'x' } }),
        assistantStream('final answer'),
      ],
      tools: [registeredTool('lookup')],
    });
    const released: string[] = [];
    const dependencies = dependenciesFrom(fixture, {
      tools: captureReleases(fixture.options.tools, released),
    });

    const result = await executeAgentRun(runInput(), dependencies);

    expect(result.status).toBe('completed');
    expect(fixture.writes).toEqual(['model', 'tool', 'assistant:completed']);
    expect(fixture.contextRuns).toHaveLength(2);
    expect(released).toEqual(['model-call:1', 'model-call:2']);
    expect(fixture.toolResults).toHaveLength(1);
    expect(fixture.toolResults[0]).toMatchObject({
      parent_entry_id: 'entry:1',
      tool_call_id: 'call:1',
      tool_name: 'lookup',
      status: 'success',
    });
    expect(fixture.assistantReplies[0]).toMatchObject({
      parent_entry_id: 'entry:2',
      status: 'completed',
    });
  });

  it('releases the Tool scope and records one failed reply when Context building fails', async () => {
    const fixture = createRunsFixture({
      contextBuild: async () => ({
        status: 'failed',
        failure: {
          code: 'context_build_failed',
          message: 'Context is unavailable.',
          retryable: false,
          cause: { owner: 'context', code: 'source_unavailable' },
        },
      }),
    });
    const released: string[] = [];
    const dependencies = dependenciesFrom(fixture, {
      tools: captureReleases(fixture.options.tools, released),
    });

    const result = await executeAgentRun(runInput(), dependencies);

    expect(result).toEqual({
      status: 'failed',
      failure: {
        code: 'context_failed',
        message: 'Context is unavailable.',
        retryable: false,
        cause: { owner: 'context', code: 'source_unavailable' },
      },
    });
    expect(fixture.writes).toEqual(['assistant:failed']);
    expect(fixture.assistantReplies).toHaveLength(1);
    expect(released).toEqual(['model-call:1']);
  });

  it('keeps Session commit failure owned by Session without claiming a terminal reply was persisted', async () => {
    const fixture = createRunsFixture({
      streams: [
        assistantStream('using tool', { id: 'call:1', name: 'lookup', arguments: {} }),
      ],
      tools: [registeredTool('lookup')],
    });
    const saveAssistantReply = vi.fn(fixture.options.session.saveAssistantReply);
    const session: Pick<SessionHistory, 'saveModelResponse' | 'saveAssistantReply' | 'saveToolResultMessage'> = {
      saveModelResponse: vi.fn(async () => ({
        status: 'failed' as const,
        failure: { code: 'session_error', message: 'Model response save failed.' },
      })),
      saveToolResultMessage: fixture.options.session.saveToolResultMessage,
      saveAssistantReply,
    };

    const result = await executeAgentRun(runInput(), dependenciesFrom(fixture, { session }));

    expect(result).toEqual({
      status: 'failed',
      failure: {
        code: 'session_failed',
        message: 'Model response save failed.',
        retryable: false,
        cause: { owner: 'session', code: 'session_failed' },
      },
    });
    expect(saveAssistantReply).not.toHaveBeenCalled();
  });

  it('bridges the Run AbortSignal into the Agent execution and persists one cancelled reply', async () => {
    const fixture = createRunsFixture({ streams: [neverEndingStream()] });
    const controller = new AbortController();

    const execution = executeAgentRun(runInput(controller.signal), dependenciesFrom(fixture));
    controller.abort();
    const result = await execution;

    expect(result).toEqual({ status: 'cancelled' });
    expect(fixture.writes).toEqual(['assistant:cancelled']);
    expect(fixture.assistantReplies).toHaveLength(1);
    expect(fixture.assistantReplies[0]).toMatchObject({
      status: 'cancelled',
      reason_code: 'user_cancelled',
    });
  });

  it('keeps permission denial model-visible so the Agent can continue to a final answer', async () => {
    const fixture = createRunsFixture({
      streams: [
        assistantStream('try tool', { id: 'call:1', name: 'protected', arguments: {} }),
        assistantStream('I cannot use that tool.'),
      ],
      tools: [registeredTool('protected')],
      permissions: permissionService((request): PermissionDecision => ({
        type: 'deny',
        operations: [...request.operations],
        safetyAssessment: 'prohibited',
        safetySummary: 'Denied.',
        reason: 'Denied in test.',
        denialCode: 'rule_denied',
      })),
    });

    const result = await executeAgentRun(runInput(), dependenciesFrom(fixture));

    expect(result.status).toBe('completed');
    expect(fixture.writes).toEqual(['model', 'tool', 'assistant:completed']);
    expect(fixture.toolResults[0]).toMatchObject({
      status: 'permission_denied',
      error: { code: 'rule_denied', message: 'Denied in test.' },
    });
  });

  it('owns the approval wait at the Engine boundary and returns the Run to running before execution', async () => {
    const fixture = createRunsFixture({
      streams: [
        assistantStream('approve tool', { id: 'call:1', name: 'protected', arguments: {} }),
        assistantStream('approved result'),
      ],
      tools: [registeredTool('protected')],
      permissions: permissionService(approvalDecisionFor),
    });
    const transitions: string[] = [];
    const input = runInput();
    const awaitApproval = vi.fn(async ({ approval }: Parameters<EngineAgentRunInput['awaitApproval']>[0]) => ({
      status: 'approved' as const,
      decision: {
        approvalRequestId: approval.runApprovalId,
        decision: 'approved' as const,
        optionId: approval.defaultOptionId,
        decidedBy: 'user' as const,
        decidedAt: NOW,
      },
    }));
    const approvalInput: EngineAgentRunInput = {
      ...input,
      transitionRunStatus: (status) => { transitions.push(status); },
      awaitApproval,
    };

    const result = await executeAgentRun(approvalInput, dependenciesFrom(fixture));

    expect(result.status).toBe('completed');
    expect(transitions).toEqual(['waiting', 'running']);
    expect(awaitApproval).toHaveBeenCalledOnce();
    expect(fixture.toolResults[0]?.status).toBe('success');
    expect(fixture.published.map((event) => event.type)).toEqual(expect.arrayContaining([
      'approval.requested',
      'approval.resolved',
    ]));
  });

  it('rebuilds overflow Context with the same Tool scope and does not project it as an ordinary retry', async () => {
    const fixture = createRunsFixture({
      streams: [errorOverflowStream(), assistantStream('after compact')],
      contextCompact: compactedOverflowCompaction,
    });
    const released: string[] = [];

    const result = await executeAgentRun(runInput(), dependenciesFrom(fixture, {
      tools: captureReleases(fixture.options.tools, released),
    }));

    expect(result.status).toBe('completed');
    expect(fixture.contextRuns).toHaveLength(2);
    expect(fixture.contextRuns).toEqual([
      expect.objectContaining({ modelCallId: 'model-call:1' }),
      expect.objectContaining({ modelCallId: 'model-call:1' }),
    ]);
    expect(released).toEqual(['model-call:1']);
    expect(fixture.published.some((event) => event.type === 'turn.retry.started')).toBe(false);
  });

  it('treats Runtime Event publication as best-effort', async () => {
    const fixture = createRunsFixture({ streams: [assistantStream('done')] });
    const events = { publish: () => { throw new Error('event sink unavailable'); } } as EventBus;

    const result = await executeAgentRun(runInput(), dependenciesFrom(fixture, { events }));

    expect(result.status).toBe('completed');
    expect(fixture.writes).toEqual(['assistant:completed']);
  });
});

function runInput(signal: AbortSignal = new AbortController().signal): EngineAgentRunInput {
  const run: Run = {
    runId: 'run:1',
    requestId: startRequest.requestId,
    workspaceId: startRequest.workspaceId,
    sessionId: startRequest.sessionId,
    userMessageId: 'message:user',
    model,
    permissionMode: startRequest.permissionMode,
    status: 'running',
    createdAt: NOW,
    startedAt: NOW,
  };
  const userEntry: SessionEntry = {
    entry_id: 'entry:user',
    session_id: run.sessionId,
    entry_type: 'message',
    message_id: run.userMessageId,
    created_at: NOW,
  };
  return {
    run,
    userInput: startRequest.input,
    userEntry,
    transitionRunStatus: vi.fn(),
    awaitApproval: vi.fn(async () => ({ status: 'cancelled' as const })),
    signal,
  };
}

function dependenciesFrom(
  fixture: ReturnType<typeof createRunsFixture>,
  overrides: Partial<EngineAgentRunDependencies> = {},
): EngineAgentRunDependencies {
  const clock: RunClock = fixture.options.clock ?? { now: () => NOW };
  return {
    models: fixture.options.models,
    context: fixture.options.context as ContextCapabilities,
    tools: fixture.options.tools,
    permissions: fixture.options.permissions,
    session: fixture.options.session,
    events: fixture.options.events,
    ids: fixture.options.ids,
    clock,
    policy: fixture.options.policy ?? runPolicy,
    ...overrides,
  };
}

function captureReleases(
  tools: EngineAgentRunDependencies['tools'],
  released: string[],
): EngineAgentRunDependencies['tools'] {
  return {
    ...tools,
    releaseModelCallTools(request) {
      released.push(request.modelCallId);
      tools.releaseModelCallTools(request);
    },
  };
}

function captureModelContexts(models: Models, captured: unknown[]): Models {
  return {
    ...models,
    streamSimple(modelInput, context, options) {
      captured.push(structuredClone(context));
      return models.streamSimple(modelInput, context, options);
    },
  } as Models;
}
