/*
 * Verifies the canonical Agent Run transcript projected from persisted Runtime Events.
 */
import { describe, expect, it } from 'vitest';
import {
  getRunTranscript,
  type AgentRun,
  type GetRunTranscriptResult,
} from '@megumi/coding-agent/agent-run';
import type { RuntimeEvent } from '@megumi/coding-agent/events';
import { createInMemoryAgentRunRepository } from './agent-run-test-helpers';

describe('getRunTranscript', () => {
  it('returns not_found when the run does not exist', () => {
    const repository = createInMemoryAgentRunRepository();

    expect(getRunTranscript(repository, 'run-missing')).toEqual({
      status: 'not_found',
      runId: 'run-missing',
    });
  });

  it('groups a tool round by modelCallId and emits assistant content before its tool call', () => {
    const repository = repositoryWithRun();
    saveEvents(repository, [
      event('tool-call', 2, 'model_call.tool_call', {
        modelCallId: 'model-call-1',
        toolCallId: 'tool-call-1',
        toolName: 'read_file',
        input: { path: 'README.md' },
      }),
      event('completed', 3, 'model_call.completed', {
        modelCallId: 'model-call-1',
        finishReason: 'tool_calls',
        content: [{ type: 'text', text: 'I will read the file.' }],
      }),
      event('result', 4, 'tool_result.created', {
        toolResultId: 'tool-result-1',
        toolCallId: 'tool-call-1',
        toolName: 'read_file',
        kind: 'success',
        content: [{ type: 'text', text: 'file contents' }],
      }),
    ]);

    expect(getRunTranscript(repository, 'run-1')).toEqual({
      status: 'found',
      transcript: {
        runId: 'run-1',
        items: [
          {
            type: 'assistant_message',
            content: [{ type: 'text', text: 'I will read the file.' }],
          },
          {
            type: 'tool_call',
            toolCallId: 'tool-call-1',
            toolName: 'read_file',
            arguments: { path: 'README.md' },
          },
          {
            type: 'tool_result',
            toolCallId: 'tool-call-1',
            toolName: 'read_file',
            status: 'success',
            content: [{ type: 'text', text: 'file contents' }],
          },
        ],
      },
    });
  });

  it('omits final stop content and ignores display-only events', () => {
    const repository = repositoryWithRun();
    saveEvents(repository, [
      event('retry', 1, 'retry.started', {
        retryRequestId: 'retry-1',
        retryKind: 'model_call',
      }),
      event('thinking', 2, 'model.thinking.delta', {
        modelStepId: 'model-call-1',
        delta: 'private reasoning',
      }),
      event('approval', 3, 'approval.resolved', {
        approvalRequestId: 'approval-1',
        decision: 'approved',
        scope: 'once',
        decidedAt: '2026-01-01T00:00:00.000Z',
      }),
      event('trace', 4, 'model_call.text_delta', {
        modelCallId: 'model-call-1',
        delta: 'Final answer.',
      }),
      event('completed', 5, 'model_call.completed', {
        modelCallId: 'model-call-1',
        finishReason: 'stop',
        content: [{ type: 'text', text: 'Final answer.' }],
      }),
    ]);

    expect(getRunTranscript(repository, 'run-1')).toEqual({
      status: 'found',
      transcript: { runId: 'run-1', items: [] },
    });
  });

  it.each([
    {
      name: 'missing',
      events: [
        event('completed', 1, 'model_call.completed', {
          modelCallId: 'model-call-1',
          finishReason: 'tool_calls',
        }),
        event('call', 2, 'model_call.tool_call', {
          modelCallId: 'model-call-1',
          toolCallId: 'tool-call-1',
          toolName: 'read_file',
          input: {},
        }),
      ],
      expected: { status: 'incomplete', runId: 'run-1', reason: 'missing_tool_result', toolCallId: 'tool-call-1' },
    },
    {
      name: 'orphan',
      events: [
        event('completed', 1, 'model_call.completed', {
          modelCallId: 'model-call-1',
          finishReason: 'stop',
        }),
        event('result', 2, 'tool_result.created', {
          toolResultId: 'tool-result-1',
          toolCallId: 'tool-call-1',
          toolName: 'read_file',
          kind: 'success',
          content: [{ type: 'text', text: 'contents' }],
        }),
      ],
      expected: { status: 'incomplete', runId: 'run-1', reason: 'orphan_tool_result', toolCallId: 'tool-call-1' },
    },
    {
      name: 'duplicate',
      events: [
        event('completed', 1, 'model_call.completed', {
          modelCallId: 'model-call-1',
          finishReason: 'tool_calls',
        }),
        event('call', 2, 'model_call.tool_call', {
          modelCallId: 'model-call-1',
          toolCallId: 'tool-call-1',
          toolName: 'read_file',
          input: {},
        }),
        event('result-a', 3, 'tool_result.created', {
          toolResultId: 'tool-result-1',
          toolCallId: 'tool-call-1',
          toolName: 'read_file',
          kind: 'success',
          content: [{ type: 'text', text: 'contents' }],
        }),
        event('result-b', 4, 'tool_result.created', {
          toolResultId: 'tool-result-2',
          toolCallId: 'tool-call-1',
          toolName: 'read_file',
          kind: 'success',
          content: [{ type: 'text', text: 'contents again' }],
        }),
      ],
      expected: { status: 'incomplete', runId: 'run-1', reason: 'duplicate_tool_result', toolCallId: 'tool-call-1' },
    },
  ])('returns the exact incomplete reason for a $name tool result', ({ events, expected }) => {
    const repository = repositoryWithRun();
    saveEvents(repository, events);

    expect(getRunTranscript(repository, 'run-1')).toEqual(expected as GetRunTranscriptResult);
  });

  it('uses sequence, createdAt, then eventId as the stable projection order', () => {
    const repository = repositoryWithRun();
    saveEvents(repository, [
      event('event-b', 2, 'model_call.tool_call', {
        modelCallId: 'model-call-1',
        toolCallId: 'tool-call-b',
        toolName: 'second_tool',
        input: { order: 2 },
      }, '2026-01-01T00:00:02.000Z'),
      event('event-c', 2, 'model_call.tool_call', {
        modelCallId: 'model-call-1',
        toolCallId: 'tool-call-c',
        toolName: 'third_tool',
        input: { order: 3 },
      }, '2026-01-01T00:00:02.000Z'),
      event('event-a', 2, 'model_call.tool_call', {
        modelCallId: 'model-call-1',
        toolCallId: 'tool-call-a',
        toolName: 'first_tool',
        input: { order: 1 },
      }, '2026-01-01T00:00:01.000Z'),
      event('completed', 3, 'model_call.completed', {
        modelCallId: 'model-call-1',
        finishReason: 'tool_calls',
      }),
      ...['a', 'b', 'c'].map((id, index) => event(`result-${id}`, 4 + index, 'tool_result.created', {
        toolResultId: `tool-result-${id}`,
        toolCallId: `tool-call-${id}`,
        toolName: `${['first', 'second', 'third'][index]}_tool`,
        kind: 'success',
        content: [{ type: 'text', text: id }],
      })),
    ]);

    const result = getRunTranscript(repository, 'run-1');
    expect(result.status).toBe('found');
    if (result.status !== 'found') return;
    expect(result.transcript.items.filter((item) => item.type === 'tool_call').map((item) => item.toolCallId))
      .toEqual(['tool-call-a', 'tool-call-b', 'tool-call-c']);
  });

  it('projects two model-call tool rounds in model-call order', () => {
    const repository = repositoryWithRun();
    saveEvents(repository, [
      ...toolRoundEvents('first', 1),
      ...toolRoundEvents('second', 4),
    ]);

    const result = getRunTranscript(repository, 'run-1');
    expect(result.status).toBe('found');
    if (result.status !== 'found') return;
    expect(result.transcript.items.map((item) => item.type === 'tool_call' ? item.toolCallId : item.type))
      .toEqual([
        'assistant_message',
        'tool-call-first',
        'tool_result',
        'assistant_message',
        'tool-call-second',
        'tool_result',
      ]);
  });

  it('fails on duplicate model-call completion facts', () => {
    const repository = repositoryWithRun();
    saveEvents(repository, [
      event('completed-a', 1, 'model_call.completed', {
        modelCallId: 'model-call-1',
        finishReason: 'stop',
        content: [{ type: 'text', text: 'first' }],
      }),
      event('completed-b', 2, 'model_call.completed', {
        modelCallId: 'model-call-1',
        finishReason: 'stop',
        content: [{ type: 'text', text: 'second' }],
      }),
    ]);

    expect(getRunTranscript(repository, 'run-1')).toEqual({
      status: 'failed',
      failure: {
        code: 'runtime_protocol_violation',
        message: 'Duplicate model_call.completed fact for modelCallId model-call-1.',
      },
    });
  });

  it('fails on a duplicate toolCallId in one model-call group', () => {
    const repository = repositoryWithRun();
    saveEvents(repository, [
      event('call-a', 1, 'model_call.tool_call', {
        modelCallId: 'model-call-1',
        toolCallId: 'tool-call-1',
        toolName: 'read_file',
        input: { path: 'a' },
      }),
      event('call-b', 2, 'model_call.tool_call', {
        modelCallId: 'model-call-1',
        toolCallId: 'tool-call-1',
        toolName: 'read_file',
        input: { path: 'b' },
      }),
      event('completed', 3, 'model_call.completed', {
        modelCallId: 'model-call-1',
        finishReason: 'tool_calls',
      }),
      event('result', 4, 'tool_result.created', {
        toolResultId: 'tool-result-1',
        toolCallId: 'tool-call-1',
        toolName: 'read_file',
        kind: 'success',
        content: [{ type: 'text', text: 'contents' }],
      }),
    ]);

    expect(getRunTranscript(repository, 'run-1')).toEqual({
      status: 'failed',
      failure: {
        code: 'runtime_protocol_violation',
        message: 'Duplicate model_call.tool_call fact for toolCallId tool-call-1.',
      },
    });
  });

  it('fails when the same toolCallId appears across model-call groups', () => {
    const repository = repositoryWithRun();
    saveEvents(repository, [
      ...toolRoundEvents('first', 1, 'shared-tool-call'),
      event('second-call', 4, 'model_call.tool_call', {
        modelCallId: 'model-call-second',
        toolCallId: 'shared-tool-call',
        toolName: 'read_file',
        input: { round: 'second' },
      }),
      event('second-completed', 5, 'model_call.completed', {
        modelCallId: 'model-call-second',
        finishReason: 'tool_calls',
      }),
    ]);

    expect(getRunTranscript(repository, 'run-1')).toEqual({
      status: 'failed',
      failure: {
        code: 'runtime_protocol_violation',
        message: 'Duplicate model_call.tool_call fact for toolCallId shared-tool-call across model calls.',
      },
    });
  });

  it('returns missing_model_call_completion for a tool-call group without completion', () => {
    const repository = repositoryWithRun();
    repository.saveRuntimeEvent(event('call', 1, 'model_call.tool_call', {
      modelCallId: 'model-call-1',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      input: {},
    }));

    expect(getRunTranscript(repository, 'run-1')).toEqual({
      status: 'incomplete',
      runId: 'run-1',
      reason: 'missing_model_call_completion',
    });
  });

  it('returns failed when persistence cannot be queried', () => {
    const repository = {
      getRun(): AgentRun {
        return sampleRun();
      },
      listRuntimeEventsByRun(): RuntimeEvent[] {
        throw new Error('database unavailable');
      },
    };

    expect(getRunTranscript(repository, 'run-1')).toEqual({
      status: 'failed',
      failure: {
        code: 'internal_error',
        message: 'Failed to project transcript for run run-1: database unavailable',
      },
    });
  });
});

function repositoryWithRun() {
  const repository = createInMemoryAgentRunRepository();
  repository.createRun(sampleRun());
  return repository;
}

function sampleRun(): AgentRun {
  return {
    run_id: 'run-1',
    workspace_id: 'workspace-1',
    session_id: 'session-1',
    model_selection: { provider_id: 'provider-1', model_id: 'model-1' },
    trigger: { type: 'user_input', user_message_id: 'message-1' },
    status: 'completed',
    created_at: '2026-01-01T00:00:00.000Z',
    completed_at: '2026-01-01T00:00:05.000Z',
  };
}

function saveEvents(repository: ReturnType<typeof createInMemoryAgentRunRepository>, events: RuntimeEvent[]): void {
  events.forEach((runtimeEvent) => repository.saveRuntimeEvent(runtimeEvent));
}

function toolRoundEvents(
  id: string,
  startingSequence: number,
  toolCallId = `tool-call-${id}`,
): RuntimeEvent[] {
  return [
    event(`${id}-call`, startingSequence, 'model_call.tool_call', {
      modelCallId: `model-call-${id}`,
      toolCallId,
      toolName: 'read_file',
      input: { round: id },
    }),
    event(`${id}-completed`, startingSequence + 1, 'model_call.completed', {
      modelCallId: `model-call-${id}`,
      finishReason: 'tool_calls',
      content: [{ type: 'text', text: `${id} round` }],
    }),
    event(`${id}-result`, startingSequence + 2, 'tool_result.created', {
      toolResultId: `tool-result-${id}`,
      toolCallId,
      toolName: 'read_file',
      kind: 'success',
      content: [{ type: 'text', text: `${id} result` }],
    }),
  ];
}

function event(
  eventId: string,
  sequence: number,
  eventType: RuntimeEvent['eventType'],
  payload: Record<string, unknown>,
  createdAt = '2026-01-01T00:00:00.000Z',
): RuntimeEvent {
  return {
    eventId,
    schemaVersion: 1,
    eventType,
    runId: 'run-1',
    sessionId: 'session-1',
    sequence,
    createdAt,
    source: 'core',
    visibility: 'system',
    persist: 'required',
    payload,
  };
}
