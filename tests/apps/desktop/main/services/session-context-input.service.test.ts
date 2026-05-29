// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { SessionRunRepository } from '@megumi/db/repos/session-run.repo';
import { SessionContextInputService } from '@megumi/desktop/main/services/session-context-input.service';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

let db: Database.Database | null = null;

function createRepository(): SessionRunRepository {
  db = new Database(':memory:');
  migrateDatabase(db);
  return new SessionRunRepository(db);
}

afterEach(() => {
  db?.close();
  db = null;
});

function runtimeEvent(overrides: Partial<RuntimeEvent>): RuntimeEvent {
  return {
    eventId: 'event-1',
    schemaVersion: 1,
    eventType: 'tool.result.created',
    sessionId: 'session-1',
    runId: 'run-old',
    stepId: 'step-tool',
    sequence: 1,
    createdAt: '2026-05-28T00:00:10.000Z',
    source: 'tool',
    visibility: 'system',
    persist: 'required',
    payload: {
      toolResultId: 'tool-result-1',
      toolUseId: 'tool-use-1',
      kind: 'success',
      summary: 'Read package.json and found package name megumi.',
    },
    ...overrides,
  };
}

describe('SessionContextInputService', () => {
  it('builds SessionContextInput from persisted session messages, summary, runs, steps, and runtime events', () => {
    const repository = createRepository();
    repository.saveSession({
      sessionId: 'session-1',
      title: 'Session',
      status: 'active',
      summary: 'User selected short-term context quality as the current stage.',
      createdAt: '2026-05-28T00:00:00.000Z',
      updatedAt: '2026-05-28T00:00:00.000Z',
    });
    repository.saveMessage({
      messageId: 'message-prev-user',
      sessionId: 'session-1',
      runId: 'run-old',
      role: 'user',
      content: 'Focus 07.03 on Session Context.',
      status: 'completed',
      createdAt: '2026-05-28T00:00:01.000Z',
      completedAt: '2026-05-28T00:00:01.000Z',
    });
    repository.saveMessage({
      messageId: 'message-prev-assistant',
      sessionId: 'session-1',
      runId: 'run-old',
      role: 'assistant',
      content: 'We will wire persisted session context next.',
      status: 'completed',
      createdAt: '2026-05-28T00:00:02.000Z',
      completedAt: '2026-05-28T00:00:02.000Z',
    });
    repository.saveMessage({
      messageId: 'message-streaming-assistant',
      sessionId: 'session-1',
      runId: 'run-old',
      role: 'assistant',
      content: 'Partial in-progress answer.',
      status: 'streaming',
      createdAt: '2026-05-28T00:00:03.000Z',
    });
    repository.saveMessage({
      messageId: 'message-host',
      sessionId: 'session-1',
      runId: 'run-old',
      role: 'host',
      content: 'Host-only tool output must not become chat history.',
      status: 'completed',
      createdAt: '2026-05-28T00:00:04.000Z',
      completedAt: '2026-05-28T00:00:04.000Z',
    });
    repository.saveMessage({
      messageId: 'message-current',
      sessionId: 'session-1',
      runId: 'run-current',
      role: 'user',
      content: 'Continue implementation.',
      status: 'completed',
      createdAt: '2026-05-28T00:00:05.000Z',
      completedAt: '2026-05-28T00:00:05.000Z',
    });
    repository.saveMessage({
      messageId: 'message-current-run-assistant',
      sessionId: 'session-1',
      runId: 'run-current',
      role: 'assistant',
      content: 'Current run draft answer must not become previous history.',
      status: 'completed',
      createdAt: '2026-05-28T00:00:06.000Z',
      completedAt: '2026-05-28T00:00:06.000Z',
    });
    repository.saveMessage({
      messageId: 'message-current-run-user-followup',
      sessionId: 'session-1',
      runId: 'run-current',
      role: 'user',
      content: 'Current run follow-up must not become previous history.',
      status: 'completed',
      createdAt: '2026-05-28T00:00:07.000Z',
      completedAt: '2026-05-28T00:00:07.000Z',
    });
    repository.saveRun({
      runId: 'run-old',
      sessionId: 'session-1',
      mode: 'default',
      goal: 'Old turn',
      status: 'completed',
      createdAt: '2026-05-28T00:00:01.000Z',
      completedAt: '2026-05-28T00:00:20.000Z',
    });
    repository.saveRun({
      runId: 'run-failed',
      sessionId: 'session-1',
      mode: 'default',
      goal: 'Failed turn',
      status: 'failed',
      createdAt: '2026-05-28T00:00:30.000Z',
      error: {
        code: 'runtime_unknown',
        message: 'Provider failed before final answer.',
        severity: 'error',
        retryable: false,
        source: 'provider',
      },
    });
    repository.saveRun({
      runId: 'run-current',
      sessionId: 'session-1',
      mode: 'default',
      goal: 'Current turn',
      status: 'running',
      createdAt: '2026-05-28T00:01:00.000Z',
    });
    repository.saveStep({
      stepId: 'step-failed',
      runId: 'run-failed',
      kind: 'model',
      status: 'failed',
      title: 'Model response',
      startedAt: '2026-05-28T00:00:31.000Z',
      error: {
        code: 'runtime_unknown',
        message: 'Model failed.',
        severity: 'error',
        retryable: false,
        source: 'provider',
      },
    });
    repository.saveStep({
      stepId: 'step-tool',
      runId: 'run-old',
      kind: 'tool',
      status: 'succeeded',
      title: 'Read package.json',
      startedAt: '2026-05-28T00:00:08.000Z',
      completedAt: '2026-05-28T00:00:10.000Z',
    });
    repository.appendRuntimeEvent(runtimeEvent({
      eventId: 'event-tool-result',
      runId: 'run-old',
      sequence: 1,
    }));
    repository.appendRuntimeEvent(runtimeEvent({
      eventId: 'event-tool-error',
      runId: 'run-old',
      sequence: 2,
      payload: {
        toolResultId: 'tool-result-error',
        toolUseId: 'tool-use-error',
        kind: 'tool_error',
        summary: 'run_command failed with exit code 1.',
      },
    }));
    repository.appendRuntimeEvent(runtimeEvent({
      eventId: 'event-tool-policy-denied',
      runId: 'run-old',
      sequence: 3,
      payload: {
        toolResultId: 'tool-result-denied',
        toolUseId: 'tool-use-denied',
        kind: 'policy_denied',
        summary: 'write_file was blocked by policy.',
      },
    }));
    repository.appendRuntimeEvent(runtimeEvent({
      eventId: 'event-tool-redacted',
      runId: 'run-old',
      sequence: 4,
      payload: {
        toolResultId: 'tool-result-redacted',
        toolUseId: 'tool-use-redacted',
        kind: 'redacted',
        summary: 'Tool output was redacted.',
      },
    }));
    repository.appendRuntimeEvent(runtimeEvent({
      eventId: 'event-tool-denied',
      eventType: 'tool.call.denied',
      runId: 'run-old',
      stepId: 'step-tool',
      sequence: 5,
      source: 'security',
      visibility: 'user',
      payload: {
        toolCallId: 'tool-call-1',
        reason: 'User denied write_file.',
      },
    }));

    const input = new SessionContextInputService({ repository }).buildSessionContextInput({
      sessionId: 'session-1',
      currentRunId: 'run-current',
      currentMessageId: 'message-current',
      builtAt: '2026-05-28T00:01:00.000Z',
      maxHistoryEntries: 12,
      maxRuntimeFacts: 12,
    });

    expect(input.maxHistoryEntries).toBe(12);
    expect(input.summaryEntries).toEqual([
      expect.objectContaining({
        summaryId: 'session-summary:session-1',
        summaryKind: 'explicit',
        text: 'User selected short-term context quality as the current stage.',
        sourceRef: expect.objectContaining({
          sourceId: 'session-summary:session-1',
          sourceKind: 'session_summary',
          sourceUri: 'session-summary://session-1',
          loadedAt: '2026-05-28T00:01:00.000Z',
        }),
        createdAt: '2026-05-28T00:00:00.000Z',
      }),
    ]);
    expect(input.historyEntries?.map((entry) => [entry.entryId, entry.role, entry.status, entry.text])).toEqual([
      ['message-prev-user', 'user', 'completed', 'Focus 07.03 on Session Context.'],
      ['message-prev-assistant', 'assistant', 'completed', 'We will wire persisted session context next.'],
      ['message-streaming-assistant', 'assistant', 'interrupted', 'Partial in-progress answer.'],
    ]);
    expect(JSON.stringify(input.historyEntries)).not.toContain('Host-only tool output');
    expect(JSON.stringify(input.historyEntries)).not.toContain('Continue implementation.');
    expect(JSON.stringify(input.historyEntries)).not.toContain('Current run draft answer');
    expect(JSON.stringify(input.historyEntries)).not.toContain('Current run follow-up');
    expect(input.runtimeFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        factKind: 'run_failed',
        severity: 'error',
        text: expect.stringContaining('Provider failed before final answer.'),
        sourceRef: expect.objectContaining({
          sourceId: 'session-run:run-failed',
          sourceKind: 'session_run',
          sourceUri: 'session-run://run-failed',
          loadedAt: '2026-05-28T00:01:00.000Z',
        }),
      }),
      expect.objectContaining({
        factKind: 'step_failed',
        severity: 'error',
        text: expect.stringContaining('Model failed.'),
        sourceRef: expect.objectContaining({
          sourceId: 'session-step:step-failed',
          sourceKind: 'session_step',
          sourceUri: 'session-step://step-failed',
          loadedAt: '2026-05-28T00:01:00.000Z',
        }),
      }),
      expect.objectContaining({
        factKind: 'tool_result',
        severity: 'info',
        text: 'Tool result: Read package.json and found package name megumi.',
        sourceRef: expect.objectContaining({
          sourceId: 'runtime-event:event-tool-result',
          sourceKind: 'tool_result',
          sourceUri: 'runtime-event://event-tool-result',
          loadedAt: '2026-05-28T00:01:00.000Z',
        }),
      }),
      expect.objectContaining({
        factKind: 'tool_error',
        severity: 'error',
        text: 'Tool result: run_command failed with exit code 1.',
      }),
      expect.objectContaining({
        factKind: 'approval',
        severity: 'warning',
        text: 'Tool result: write_file was blocked by policy.',
      }),
      expect.objectContaining({
        factKind: 'tool_result',
        severity: 'warning',
        text: 'Tool result: Tool output was redacted.',
      }),
      expect.objectContaining({
        factKind: 'approval',
        severity: 'warning',
        text: 'Tool call denied: User denied write_file.',
        sourceRef: expect.objectContaining({
          sourceId: 'runtime-event:event-tool-denied',
          sourceKind: 'approval',
          sourceUri: 'runtime-event://event-tool-denied',
          loadedAt: '2026-05-28T00:01:00.000Z',
        }),
      }),
    ]));
    expect(input.runtimeFacts?.map((fact) => fact.factId)).toEqual([
      'runtime-event:event-tool-result',
      'runtime-event:event-tool-error',
      'runtime-event:event-tool-policy-denied',
      'runtime-event:event-tool-redacted',
      'runtime-event:event-tool-denied',
      'session-run:run-failed:run-failed',
      'session-step:step-failed:step-failed',
    ]);
  });

  it('keeps recent history and runtime facts bounded without reading renderer timeline state', () => {
    const repository = createRepository();
    repository.saveSession({
      sessionId: 'session-1',
      title: 'Session',
      status: 'active',
      createdAt: '2026-05-28T00:00:00.000Z',
      updatedAt: '2026-05-28T00:00:00.000Z',
    });
    for (let index = 1; index <= 5; index += 1) {
      repository.saveMessage({
        messageId: `message-${index}`,
        sessionId: 'session-1',
        role: index % 2 === 0 ? 'assistant' : 'user',
        content: `Message ${index}`,
        status: 'completed',
        createdAt: `2026-05-28T00:00:0${index}.000Z`,
        completedAt: `2026-05-28T00:00:0${index}.000Z`,
      });
      repository.saveRun({
        runId: `run-${index}`,
        sessionId: 'session-1',
        mode: 'default',
        goal: `Run ${index}`,
        status: 'failed',
        createdAt: `2026-05-28T00:00:1${index}.000Z`,
        error: {
          code: 'runtime_unknown',
          message: `Failure ${index}`,
          severity: 'error',
          retryable: false,
          source: 'provider',
        },
      });
    }

    const input = new SessionContextInputService({ repository }).buildSessionContextInput({
      sessionId: 'session-1',
      builtAt: '2026-05-28T00:01:00.000Z',
      maxHistoryEntries: 2,
      maxRuntimeFacts: 2,
    });

    expect(input.maxHistoryEntries).toBe(2);
    expect(input.historyEntries?.map((entry) => entry.text)).toEqual(['Message 4', 'Message 5']);
    expect(input.runtimeFacts?.map((fact) => fact.text)).toEqual([
      'Previous run failed before a final answer. Error: Failure 4',
      'Previous run failed before a final answer. Error: Failure 5',
    ]);
  });
});
