/*
 * Verifies one tolerant Agent Run historical query independent of Run outcome.
 */
import { describe, expect, it } from 'vitest';
import { getHistoricalRun, type AgentRun } from '@megumi/coding-agent/agent-run';
import type { RuntimeEvent } from '@megumi/coding-agent/events';
import { createInMemoryAgentRunRepository } from './agent-run-test-helpers';

describe('getHistoricalRun', () => {
  it('builds a cancelled historical Run without inventing a missing Tool Result', () => {
    const repository = createInMemoryAgentRunRepository();
    repository.createRun(run('cancelled'));
    repository.saveRuntimeEvent(event('call', 1, 'model_call.tool_call', {
      modelCallId: 'model-call-1',
      toolCallId: 'tool-call-1',
      toolName: 'write_file',
      input: { path: 'hollow-world.ts' },
    }));
    repository.saveRuntimeEvent(event('completed', 2, 'model_call.completed', {
      modelCallId: 'model-call-1',
      finishReason: 'tool_calls',
      content: [{ type: 'text', text: 'I will create the file.' }],
    }));
    repository.saveRuntimeEvent(event('cancelled', 3, 'run.cancelled', {
      reason: 'runtime_started_cleanup',
      error: {
        code: 'runtime_cancelled',
        message: 'Runtime restarted before the Agent Run reached a terminal state.',
        severity: 'warning',
        retryable: false,
        source: 'core',
      },
    }));

    expect(getHistoricalRun(repository, 'run-1')).toEqual({
      status: 'found',
      historicalRun: {
        runId: 'run-1',
        runStatus: 'cancelled',
        modelSteps: [{
          modelCallId: 'model-call-1',
          assistantContent: [{ type: 'text', text: 'I will create the file.' }],
          toolCalls: [{
              toolCallId: 'tool-call-1',
              toolName: 'write_file',
              arguments: { path: 'hollow-world.ts' },
            }],
        }],
        finalOutcome: {
          reason: 'runtime_started_cleanup',
          code: 'runtime_cancelled',
          message: 'Runtime restarted before the Agent Run reached a terminal state.',
        },
        diagnostics: [],
      },
    });
  });

  it('keeps a missing Tool Result as an optional fact for a completed Run', () => {
    const repository = createInMemoryAgentRunRepository();
    repository.createRun(run('completed'));
    repository.saveRuntimeEvent(event('call', 1, 'model_call.tool_call', {
      modelCallId: 'model-call-1',
      toolCallId: 'tool-call-1',
      toolName: 'write_file',
      input: { path: 'hollow-world.ts' },
    }));
    repository.saveRuntimeEvent(event('completed', 2, 'model_call.completed', {
      modelCallId: 'model-call-1',
      finishReason: 'tool_calls',
    }));

    expect(getHistoricalRun(repository, 'run-1')).toMatchObject({
      status: 'found',
      historicalRun: {
        runStatus: 'completed',
        modelSteps: [{ toolCalls: [{ toolCallId: 'tool-call-1' }] }],
        diagnostics: [],
      },
    });
  });

  it('reads a non-terminal Run status as a historical fact', () => {
    const repository = createInMemoryAgentRunRepository();
    repository.createRun(run('waiting_for_approval'));

    expect(getHistoricalRun(repository, 'run-1')).toEqual({
      status: 'found',
      historicalRun: {
        runId: 'run-1',
        runStatus: 'waiting_for_approval',
        modelSteps: [],
        diagnostics: [],
      },
    });
  });
});

function run(status: AgentRun['status']): AgentRun {
  return {
    run_id: 'run-1',
    workspace_id: 'workspace-1',
    session_id: 'session-1',
    model_selection: { provider_id: 'provider-1', model_id: 'model-1' },
    trigger: { type: 'user_input', user_message_id: 'message-1' },
    status,
    created_at: '2026-01-01T00:00:00.000Z',
    ...(status === 'completed' || status === 'failed' || status === 'cancelled'
      ? { completed_at: '2026-01-01T00:00:05.000Z' }
      : {}),
  };
}

function event(
  eventId: string,
  sequence: number,
  eventType: RuntimeEvent['eventType'],
  payload: Record<string, unknown>,
): RuntimeEvent {
  return {
    eventId,
    schemaVersion: 1,
    eventType,
    runId: 'run-1',
    sessionId: 'session-1',
    sequence,
    createdAt: '2026-01-01T00:00:00.000Z',
    source: 'core',
    visibility: 'system',
    persist: 'required',
    payload,
  };
}
