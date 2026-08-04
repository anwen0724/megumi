/*
 * Verifies the Engine's Runtime Event emission against the new domain model:
 * the run lifecycle, the streaming turn/message pair, session ownership, and
 * the ordering contract (user message precedes run.started, no runId).
 */
import { describe, expect, it, vi } from 'vitest';
import type { AnyEvent } from '@megumi/events';
import {
  assistantStream,
  collectEvents,
  createEngineFixture,
  startedRun,
} from './engine-test-fixtures';
import { registeredTool } from './tool-call-test-fixtures';

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
    });
    const toolEnded = events.find((event) => event.type === 'tool_execution.ended');
    expect(toolEnded?.payload.status).toBe('completed');
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
      error: { code: 'context_failed' },
    });
  });
});
