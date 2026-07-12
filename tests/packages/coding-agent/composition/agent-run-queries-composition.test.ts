/*
 * Verifies composition of the public Agent Run query surface without unrelated runtime modules.
 */
import { describe, expect, it } from 'vitest';
import { createAgentRunQueries } from '@megumi/coding-agent/composition/compose-coding-agent-runtime';
import { createInMemoryAgentRunRepository } from '../agent-run/agent-run-test-helpers';

describe('Agent Run query composition', () => {
  it('routes getHistoricalRun through the Agent Run owner projection', () => {
    const repository = createInMemoryAgentRunRepository();
    repository.createRun({
      run_id: 'run-1',
      workspace_id: 'workspace-1',
      session_id: 'session-1',
      model_selection: { provider_id: 'provider-1', model_id: 'model-1' },
      trigger: { type: 'user_input', user_message_id: 'message-1' },
      status: 'completed',
      created_at: '2026-01-01T00:00:00.000Z',
      completed_at: '2026-01-01T00:00:01.000Z',
    });
    repository.saveRuntimeEvent({
      eventId: 'event-1',
      schemaVersion: 1,
      eventType: 'model_call.completed',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 1,
      createdAt: '2026-01-01T00:00:01.000Z',
      source: 'core',
      visibility: 'system',
      persist: 'required',
      payload: {
        modelCallId: 'model-call-1',
        finishReason: 'stop',
        content: [{ type: 'text', text: 'Session owns this final answer.' }],
      },
    });

    const queries = createAgentRunQueries(repository);

    expect(queries.getHistoricalRun('run-1')).toEqual({
      status: 'found',
      historicalRun: {
        runId: 'run-1',
        runStatus: 'completed',
        modelSteps: [{
          modelCallId: 'model-call-1',
          assistantContent: [{ type: 'text', text: 'Session owns this final answer.' }],
          toolCalls: [],
        }],
        diagnostics: [],
      },
    });
  });
});
