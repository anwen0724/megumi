/*
 * Verifies the Engine's Runtime Event emission against the new domain model:
 * the run lifecycle, the streaming turn/message pair, session ownership, the
 * ordering contract (user message precedes run.started, no runId), and the
 * full behaviour surface (thinking stream, tool requests, approval options,
 * retries, plan updates, permission denials).
 */
import type { PermissionDecision } from '@megumi/permissions';
import { describe, expect, it, vi } from 'vitest';
import type { AnyEvent } from '@megumi/events';
import {
  approvalDecisionFor,
  assistantStream,
  assistantThinkingStream,
  collectEvents,
  createEngineFixture,
  retryableFailedStream,
  startedRun,
} from './engine-test-fixtures';
import {
  permissionService,
  registeredTool,
  succeeded,
} from './tool-call-test-fixtures';

describe('Engine RuntimeEvents', () => {
  it('emits the run lifecycle with session ownership and the ordering contract', async () => {
    const fixture = createEngineFixture({
      streams: [assistantStream('answer')],
    });

    const started = await startedRun(fixture);
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'run.ended')).toBe(true);
    });

    const events = collectEvents(fixture, started.run.runId);

    // Every run event carries sessionId + runId; sequences are strictly
    // increasing (the user message, which precedes the run, occupies earlier
    // sequence numbers in the same session stream).
    for (const event of events) {
      expect(event.sessionId).toBe('session:1');
      expect(event.runId).toBe(started.run.runId);
    }
    const sequences = events.map((event) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  it('emits the user message before run.started, without a runId', async () => {
    const fixture = createEngineFixture({
      streams: [assistantStream('answer')],
    });

    const started = await startedRun(fixture);
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'run.ended')).toBe(true);
    });

    const userStarted = fixture.published.find(
      (event): event is AnyEvent & { payload: { role: 'user' } } =>
        event.type === 'message.started' && event.payload.role === 'user',
    );
    const runStarted = fixture.published.find((event) => event.type === 'run.started');

    expect(userStarted).toBeDefined();
    expect(userStarted?.runId).toBeUndefined();
    expect(runStarted).toBeDefined();
    expect(userStarted!.sequence).toBeLessThan(runStarted!.sequence);
  });

  it('streams the assistant answer as full-snapshot message updates', async () => {
    const fixture = createEngineFixture({
      streams: [assistantStream('answer')],
    });

    const started = await startedRun(fixture);
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'run.ended')).toBe(true);
    });

    const updates = fixture.published.filter(
      (event): event is typeof event & { payload: { role: 'assistant'; messageId: string; content: string } } =>
        event.type === 'message.update',
    );
    const ended = fixture.published.find(
      (event): event is typeof event & { payload: { role: 'assistant'; messageId: string; content: string } } =>
        event.type === 'message.ended' && event.payload.role === 'assistant',
    );

    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) {
      expect(update.payload.role).toBe('assistant');
      expect(typeof update.payload.content).toBe('string');
    }
    // The settled message supersedes the snapshots with the same messageId.
    expect(ended).toBeDefined();
    expect(ended!.payload.messageId).toBe(updates[0]?.payload.messageId);
    expect(ended!.payload.content).toContain('answer');
  });

  it('publishes turn and tool lifecycle events for a tool round', async () => {
    const tool = registeredTool('test-tool');
    const fixture = createEngineFixture({
      tools: [tool],
      streams: [
        assistantStream('tool', {
          id: 'provider-call:1',
          name: tool.registeredToolName,
          arguments: { value: 'x' },
        }),
        assistantStream('final answer'),
      ],
    });

    const started = await startedRun(fixture);
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'tool_execution.ended')).toBe(true);
    });

    const events = collectEvents(fixture, started.run.runId);
    const eventTypes = events.map((event) => event.type);

    expect(eventTypes).toEqual(expect.arrayContaining([
      'turn.started',
      'turn.ended',
      'tool_execution.started',
      'tool_execution.ended',
      'message.started',
      'message.ended',
    ]));

    const turnEnded = events.find((event) => event.type === 'turn.ended');
    expect(turnEnded?.payload.stopReason).toBe('tool_calls');
    expect(turnEnded?.payload.toolCallIds).toContain('provider-call:1');

    const toolStarted = events.find((event) => event.type === 'tool_execution.started');
    expect(toolStarted?.payload).toMatchObject({
      toolCallId: 'provider-call:1',
      toolName: 'test-tool',
      toolExecutionId: expect.any(String),
    });
    const toolEnded = events.find((event) => event.type === 'tool_execution.ended');
    expect(toolEnded?.payload).toMatchObject({
      status: 'completed',
      toolExecutionId: expect.any(String),
    });
  });

  it('carries the full run.started fact: request, model, and kind', async () => {
    const fixture = createEngineFixture({
      streams: [assistantStream('answer')],
    });

    const started = await startedRun(fixture);
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'run.ended')).toBe(true);
    });

    const runStarted = fixture.published.find((event) => event.type === 'run.started');
    expect(runStarted?.payload).toMatchObject({
      requestId: started.run.requestId,
      providerId: 'provider:test',
      modelId: 'model:test',
    });
  });

  it('streams thinking as full-snapshot message.thinking.update events', async () => {
    const fixture = createEngineFixture({
      streams: [assistantThinkingStream('ponder xyz', 'answer')],
    });

    const started = await startedRun(fixture);
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'run.ended')).toBe(true);
    });

    const updates = fixture.published.filter(
      (event): event is typeof event & { payload: { messageId: string; thinking: string } } =>
        event.type === 'message.thinking.update',
    );
    expect(updates.length).toBeGreaterThan(0);
    const last = updates.at(-1)!;
    expect(last.payload.thinking).toContain('ponder xyz');
    expect(last.payload.messageId).toBeTruthy();
    // Snapshot semantics: a thinking delta replaces the previous snapshot.
    expect(updates[0]?.payload.thinking).toBe(updates.at(-1)?.payload.thinking);
  });

  it('publishes tool_execution.requested when the model asks for a tool, before it starts', async () => {
    const tool = registeredTool('test-tool');
    const fixture = createEngineFixture({
      tools: [tool],
      streams: [
        assistantStream('tool', {
          id: 'provider-call:1',
          name: tool.registeredToolName,
          arguments: { value: 'x' },
        }),
        assistantStream('final answer'),
      ],
    });

    const started = await startedRun(fixture);
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'tool_execution.ended')).toBe(true);
    });

    const events = collectEvents(fixture, started.run.runId);
    const requested = events.find((event) => event.type === 'tool_execution.requested');
    const startedAt = events.find((event) => event.type === 'tool_execution.started');
    expect(requested).toBeDefined();
    expect(requested?.payload).toMatchObject({
      toolCallId: 'provider-call:1',
      toolName: 'test-tool',
      args: { value: 'x' },
      modelCallId: expect.any(String),
    });
    expect(requested!.sequence).toBeLessThan(startedAt!.sequence);
  });

  it('publishes approval.requested with options and settles a denial', async () => {
    const tool = registeredTool('test-tool');
    const fixture = createEngineFixture({
      tools: [tool],
      permissions: permissionService((request) => approvalDecisionFor(request)),
      streams: [
        assistantStream('tool', {
          id: 'provider-call:1',
          name: tool.registeredToolName,
          arguments: { value: 'x' },
        }),
        assistantStream('final answer'),
      ],
    });

    const started = await startedRun(fixture);
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'approval.requested')).toBe(true);
    });

    const requested = fixture.published.find((event) => event.type === 'approval.requested')!;
    expect(requested.payload).toMatchObject({
      toolCallId: 'provider-call:1',
      toolName: 'test-tool',
      toolIdentity: {
        sourceId: 'built_in',
        namespace: 'megumi',
        sourceToolName: 'test-tool',
      },
    });
    const payload = requested.payload as {
      options: unknown[];
      defaultOptionId: string;
      operations: unknown[];
    };
    expect(payload.options.length).toBeGreaterThan(0);
    expect(payload.defaultOptionId).toBe(payload.options[0] && (payload.options[0] as { optionId: string }).optionId);
    expect(payload.operations.length).toBeGreaterThan(0);

    const approvalResolution = await fixture.engine.resolveApproval({
      approvalId: (requested.payload as { approvalRequestId: string }).approvalRequestId,
      decision: { decision: 'denied' },
    });
    expect(approvalResolution.status).toBe('accepted');
    await vi.waitFor(() => {
      expect(fixture.published.some(
        (event) => event.type === 'approval.resolved' && event.payload.decision === 'denied',
      )).toBe(true);
    });

    // The resolved fact carries the identity and decision time; a denial has no option.
    const resolved = fixture.published.find(
      (event) => event.type === 'approval.resolved' && event.payload.decision === 'denied',
    )!;
    expect(resolved.payload).toMatchObject({
      approvalRequestId: (requested.payload as { approvalRequestId: string }).approvalRequestId,
      toolCallId: 'provider-call:1',
      decision: 'denied',
      // The engine stamps the decision time from its clock.
      decidedAt: '2026-07-31T00:00:00.000Z',
    });
    expect((resolved.payload as { optionId?: string }).optionId).toBeUndefined();
  });

  it('publishes turn.retry lifecycle events for a retried model call', async () => {
    const fixture = createEngineFixture({
      streams: [retryableFailedStream('attempt one'), assistantStream('answer')],
      policy: { maxModelCallAttempts: 2 },
    });

    const started = await startedRun(fixture);
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'run.ended')).toBe(true);
    });

    const events = collectEvents(fixture, started.run.runId);
    const retryStarted = events.find((event) => event.type === 'turn.retry.started');
    const retryCompleted = events.find((event) => event.type === 'turn.retry.completed');
    expect(retryStarted?.payload).toMatchObject({ attemptNumber: 2, retryKind: 'model_call' });
    expect(retryCompleted?.payload).toMatchObject({ attemptNumber: 2 });
  });

  it('carries the failure code when a retry is exhausted', async () => {
    const fixture = createEngineFixture({
      streams: [retryableFailedStream('attempt one'), retryableFailedStream('attempt two')],
      policy: { maxModelCallAttempts: 2 },
    });

    const started = await startedRun(fixture);
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'run.ended')).toBe(true);
    });

    const events = collectEvents(fixture, started.run.runId);
    const retryFailed = events.find((event) => event.type === 'turn.retry.failed');
    expect(retryFailed?.payload).toMatchObject({
      attemptNumber: 2,
      error: { code: 'model_call_failed' },
    });
  });

  it('publishes tool_execution.plan_updated from a plan tool notification', async () => {
    const tool = registeredTool('run_command');
    const fixture = createEngineFixture({
      tools: [tool],
      executeTool: async ({ toolName }, options) => {
        options?.onNotification?.({
          type: 'plan_updated',
          explanation: 'do things',
          plan: [{ step: 'first', status: 'pending' }],
        });
        return succeeded(toolName);
      },
      streams: [
        assistantStream('tool', {
          id: 'provider-call:1',
          name: 'run_command',
          arguments: { value: 'x' },
        }),
        assistantStream('final answer'),
      ],
    });

    const started = await startedRun(fixture);
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'tool_execution.plan_updated')).toBe(true);
    });

    const plan = fixture.published.find((event) => event.type === 'tool_execution.plan_updated')!;
    expect(plan.payload).toMatchObject({
      toolCallId: 'provider-call:1',
      explanation: 'do things',
      plan: [{ step: 'first', status: 'pending' }],
    });
  });

  it('settles a permission-denied tool call as tool_execution.ended denied', async () => {
    const tool = registeredTool('test-tool');
    const fixture = createEngineFixture({
      tools: [tool],
      permissions: permissionService((request): PermissionDecision => ({
        type: 'deny',
        operations: [...request.operations],
        safetyAssessment: 'prohibited',
        safetySummary: 'Denied.',
        reason: 'Denied in test.',
        denialCode: 'rule_denied',
      })),
      streams: [
        assistantStream('tool', {
          id: 'provider-call:1',
          name: tool.registeredToolName,
          arguments: { value: 'x' },
        }),
        assistantStream('final answer'),
      ],
    });

    const started = await startedRun(fixture);
    await vi.waitFor(() => {
      expect(fixture.published.some(
        (event) => event.type === 'tool_execution.ended' && event.payload.status === 'denied',
      )).toBe(true);
    });
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'run.ended')).toBe(true);
    });

    const events = collectEvents(fixture, started.run.runId);
    expect(events.some((event) => event.type === 'run.ended' && event.payload.status === 'completed')).toBe(true);
  });

  it('settles a failed run as run.ended with the failure', async () => {
    const fixture = createEngineFixture({
      streams: [assistantStream('answer')],
      contextBuild: async () => ({
        status: 'failed',
        failure: {
          code: 'context_build_failed',
          message: 'context unavailable',
          retryable: false,
        },
      }),
    });

    await startedRun(fixture);
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'run.ended')).toBe(true);
    });

    const ended = fixture.published.at(-1);
    expect(ended?.type).toBe('run.ended');
    expect(ended?.payload).toMatchObject({
      status: 'failed',
      error: { code: 'context_failed', retryable: false },
    });
  });

  it('carries the settled reply reference on a completed run', async () => {
    const fixture = createEngineFixture({
      streams: [assistantStream('answer')],
    });

    const started = await startedRun(fixture);
    await vi.waitFor(() => {
      expect(fixture.published.some((event) => event.type === 'run.ended')).toBe(true);
    });

    const ended = fixture.published.find(
      (event) => event.type === 'run.ended' && event.payload.status === 'completed',
    );
    expect(ended).toBeDefined();
    const payload = ended!.payload as { assistantMessageId?: string };
    expect(typeof payload.assistantMessageId).toBe('string');
    expect(payload.assistantMessageId!.length).toBeGreaterThan(0);
  });
});
