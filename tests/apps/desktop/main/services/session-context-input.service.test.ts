// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { SessionRunRepository } from '@megumi/db/repos/session-run.repo';
import { SessionActivePathRepository } from '@megumi/db/repos/session-active-path.repo';
import { SessionContextInputService } from '@megumi/desktop/main/services/session-context-input.service';
import type { ModelInputContextSourceKind, ModelInputContextSourceRef } from '@megumi/shared/model';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { SessionMessage } from '@megumi/shared/session';

let db: Database.Database | null = null;

function createRepositories(): {
  repository: SessionRunRepository;
  activePathRepository: SessionActivePathRepository;
} {
  db = new Database(':memory:');
  migrateDatabase(db);
  return {
    repository: new SessionRunRepository(db),
    activePathRepository: new SessionActivePathRepository(db),
  };
}

afterEach(() => {
  db?.close();
  db = null;
});

function sourceRef(sourceKind: ModelInputContextSourceKind, sourceId: string): ModelInputContextSourceRef {
  const sourceUriPrefix: Partial<Record<ModelInputContextSourceKind, string>> = {
    session_message: 'session-message',
    session_run: 'session-run',
    session_summary: 'session-compaction',
    session_step: 'session-step',
    tool_result: 'tool-result',
    approval: 'approval',
    branch_marker: 'branch-marker',
    retry_attempt: 'retry-attempt',
    interrupted_run_marker: 'interrupted-run-marker',
  };
  const prefix = sourceUriPrefix[sourceKind] ?? sourceKind.replaceAll('_', '-');

  return {
    sourceKind,
    sourceId,
    sourceUri: `${prefix}://${sourceId}`,
    loadedAt: '2026-05-28T00:00:00.000Z',
  };
}

function appendActivePath(
  activePathRepository: SessionActivePathRepository,
  sessionId: string,
  entries: Array<{
    sourceEntryId: string;
    sourceKind: ModelInputContextSourceKind;
    sourceId: string;
    createdAt: string;
  }>,
): void {
  let parentSourceEntryId: string | undefined;

  for (const entry of entries) {
    activePathRepository.appendSourceEntryAndSetActiveLeaf({
      sourceEntryId: entry.sourceEntryId,
      sessionId,
      ...(parentSourceEntryId ? { parentSourceEntryId } : {}),
      sourceRef: sourceRef(entry.sourceKind, entry.sourceId),
      createdAt: entry.createdAt,
    }, {
      sessionId,
      leafSourceEntryId: entry.sourceEntryId,
      updatedAt: entry.createdAt,
      reason: entry.sourceKind === 'branch_marker' ? 'branch_marker' : 'source_appended',
    });
    parentSourceEntryId = entry.sourceEntryId;
  }
}

function saveCompletedMessage(
  repository: SessionRunRepository,
  input: {
    messageId: string;
    sessionId?: string;
    runId?: string;
    role: SessionMessage['role'];
    content: string;
    createdAt: string;
    status?: SessionMessage['status'];
  },
): void {
  repository.saveMessage({
    messageId: input.messageId,
    sessionId: input.sessionId ?? 'session-1',
    ...(input.runId ? { runId: input.runId } : {}),
    role: input.role,
    content: input.content,
    status: input.status ?? 'completed',
    createdAt: input.createdAt,
    ...(input.status && input.status !== 'completed' ? {} : { completedAt: input.createdAt }),
  });
}

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
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      kind: 'success',
      summary: 'Read package.json and found package name megumi.',
    },
    ...overrides,
  };
}

describe('SessionContextInputService', () => {
  it('builds SessionContextInput from active path messages, summary, runs, steps, and runtime events', () => {
    const { repository, activePathRepository } = createRepositories();
    repository.saveSession({
      sessionId: 'session-1',
      title: 'Session',
      status: 'active',
      summary: 'User selected short-term context quality as the current stage.',
      createdAt: '2026-05-28T00:00:00.000Z',
      updatedAt: '2026-05-28T00:00:00.000Z',
    });
    saveCompletedMessage(repository, {
      messageId: 'message-prev-user',
      runId: 'run-old',
      role: 'user',
      content: 'Focus 07.03 on Session Context.',
      createdAt: '2026-05-28T00:00:01.000Z',
    });
    saveCompletedMessage(repository, {
      messageId: 'message-prev-assistant',
      runId: 'run-old',
      role: 'assistant',
      content: 'We will wire persisted session context next.',
      createdAt: '2026-05-28T00:00:02.000Z',
    });
    saveCompletedMessage(repository, {
      messageId: 'message-streaming-assistant',
      runId: 'run-old',
      role: 'assistant',
      content: 'Partial in-progress answer.',
      status: 'streaming',
      createdAt: '2026-05-28T00:00:03.000Z',
    });
    saveCompletedMessage(repository, {
      messageId: 'message-host',
      runId: 'run-old',
      role: 'host',
      content: 'Host-only tool output must not become chat history.',
      createdAt: '2026-05-28T00:00:04.000Z',
    });
    saveCompletedMessage(repository, {
      messageId: 'message-current',
      runId: 'run-current',
      role: 'user',
      content: 'Continue implementation.',
      createdAt: '2026-05-28T00:00:05.000Z',
    });
    saveCompletedMessage(repository, {
      messageId: 'message-current-run-assistant',
      runId: 'run-current',
      role: 'assistant',
      content: 'Current run draft answer must not become previous history.',
      createdAt: '2026-05-28T00:00:06.000Z',
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
        toolCallId: 'tool-call-error',
        toolExecutionId: 'tool-execution-error',
        kind: 'tool_error',
        summary: 'run_command failed with exit code 1.',
      },
    }));
    repository.appendRuntimeEvent(runtimeEvent({
      eventId: 'event-tool-denied',
      eventType: 'tool.execution.denied',
      runId: 'run-old',
      stepId: 'step-tool',
      sequence: 3,
      source: 'security',
      visibility: 'user',
      payload: {
        toolCallId: 'tool-call-1',
        toolExecutionId: 'tool-execution-1',
        reason: 'User denied write_file.',
      },
    }));
    appendActivePath(activePathRepository, 'session-1', [
      { sourceEntryId: 'source-entry-message-prev-user', sourceKind: 'session_message', sourceId: 'message-prev-user', createdAt: '2026-05-28T00:00:01.000Z' },
      { sourceEntryId: 'source-entry-run-old', sourceKind: 'session_run', sourceId: 'run-old', createdAt: '2026-05-28T00:00:01.500Z' },
      { sourceEntryId: 'source-entry-message-prev-assistant', sourceKind: 'session_message', sourceId: 'message-prev-assistant', createdAt: '2026-05-28T00:00:02.000Z' },
      { sourceEntryId: 'source-entry-message-streaming-assistant', sourceKind: 'session_message', sourceId: 'message-streaming-assistant', createdAt: '2026-05-28T00:00:03.000Z' },
      { sourceEntryId: 'source-entry-message-host', sourceKind: 'session_message', sourceId: 'message-host', createdAt: '2026-05-28T00:00:04.000Z' },
      { sourceEntryId: 'source-entry-run-failed', sourceKind: 'session_run', sourceId: 'run-failed', createdAt: '2026-05-28T00:00:30.000Z' },
      { sourceEntryId: 'source-entry-message-current', sourceKind: 'session_message', sourceId: 'message-current', createdAt: '2026-05-28T00:00:05.000Z' },
      { sourceEntryId: 'source-entry-run-current', sourceKind: 'session_run', sourceId: 'run-current', createdAt: '2026-05-28T00:01:00.000Z' },
      { sourceEntryId: 'source-entry-message-current-run-assistant', sourceKind: 'session_message', sourceId: 'message-current-run-assistant', createdAt: '2026-05-28T00:00:06.000Z' },
    ]);

    const input = new SessionContextInputService({ repository, activePathRepository }).buildSessionContextInput({
      sessionId: 'session-1',
      currentRunId: 'run-current',
      currentMessageId: 'message-current',
      builtAt: '2026-05-28T00:01:00.000Z',
      maxHistoryEntries: 12,
      maxRuntimeFacts: 12,
    });

    expect(input.summaryEntries?.[0]).toMatchObject({
      summaryId: 'session-summary:session-1',
      summaryKind: 'explicit',
      text: 'User selected short-term context quality as the current stage.',
    });
    expect(input.historyEntries?.map((entry) => [entry.sourceRef.sourceId, entry.role, entry.status, entry.text]))
      .toEqual([
        ['message-prev-user', 'user', 'completed', 'Focus 07.03 on Session Context.'],
        ['message-prev-assistant', 'assistant', 'completed', 'We will wire persisted session context next.'],
      ]);
    expect(JSON.stringify(input.historyEntries)).not.toContain('Partial in-progress answer');
    expect(JSON.stringify(input.historyEntries)).not.toContain('Host-only tool output');
    expect(JSON.stringify(input.historyEntries)).not.toContain('Continue implementation.');
    expect(JSON.stringify(input.historyEntries)).not.toContain('Current run draft answer');
    expect(input.runtimeFacts?.map((fact) => fact.factId)).toEqual([
      'runtime-event:event-tool-result',
      'runtime-event:event-tool-error',
      'runtime-event:event-tool-denied',
      'session-run:run-failed:run-failed',
      'session-step:step-failed:step-failed',
    ]);
    expect(input.runtimeFacts?.slice(-2).map((fact) => fact.sourceRef.sourceId)).toEqual([
      'run-failed',
      'step-failed',
    ]);
  });

  it('keeps recent active path history and runtime facts bounded', () => {
    const { repository, activePathRepository } = createRepositories();
    repository.saveSession({
      sessionId: 'session-1',
      title: 'Session',
      status: 'active',
      createdAt: '2026-05-28T00:00:00.000Z',
      updatedAt: '2026-05-28T00:00:00.000Z',
    });
    const activeEntries: Parameters<typeof appendActivePath>[2] = [];
    for (let index = 1; index <= 5; index += 1) {
      saveCompletedMessage(repository, {
        messageId: `message-${index}`,
        role: index % 2 === 0 ? 'assistant' : 'user',
        content: `Message ${index}`,
        createdAt: `2026-05-28T00:00:0${index}.000Z`,
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
      activeEntries.push(
        { sourceEntryId: `source-entry-message-${index}`, sourceKind: 'session_message', sourceId: `message-${index}`, createdAt: `2026-05-28T00:00:0${index}.000Z` },
        { sourceEntryId: `source-entry-run-${index}`, sourceKind: 'session_run', sourceId: `run-${index}`, createdAt: `2026-05-28T00:00:1${index}.000Z` },
      );
    }
    appendActivePath(activePathRepository, 'session-1', activeEntries);

    const input = new SessionContextInputService({ repository, activePathRepository }).buildSessionContextInput({
      sessionId: 'session-1',
      builtAt: '2026-05-28T00:01:00.000Z',
      maxHistoryEntries: 2,
      maxRuntimeFacts: 2,
    });

    expect(input.historyEntries?.map((entry) => entry.text)).toEqual(['Message 4', 'Message 5']);
    expect(input.runtimeFacts?.map((fact) => fact.text)).toEqual([
      'Previous run failed before a final answer. Error: Failure 4',
      'Previous run failed before a final answer. Error: Failure 5',
    ]);
  });

  it('selects messages, run facts, and summaries only from the active sibling branch', () => {
    const { repository, activePathRepository } = createRepositories();
    repository.saveSession({
      sessionId: 'session-1',
      title: 'Session',
      status: 'active',
      createdAt: '2026-05-31T08:00:00.000Z',
      updatedAt: '2026-05-31T08:00:00.000Z',
    });
    for (const message of [
      ['message-root-user', 'user', 'Root user request.', '2026-05-31T08:01:00.000Z'],
      ['message-assistant-a', 'assistant', 'Assistant A answer.', '2026-05-31T08:02:00.000Z'],
      ['message-current-user', 'user', 'Current branch user request.', '2026-05-31T08:03:00.000Z'],
      ['message-old-branch-user', 'user', 'Old branch user request.', '2026-05-31T08:04:00.000Z'],
      ['message-old-branch-assistant', 'assistant', 'Old branch assistant answer.', '2026-05-31T08:05:00.000Z'],
    ] as const) {
      saveCompletedMessage(repository, {
        messageId: message[0],
        role: message[1],
        content: message[2],
        createdAt: message[3],
      });
    }
    repository.saveRun({
      runId: 'run-a',
      sessionId: 'session-1',
      mode: 'default',
      goal: 'Run A',
      status: 'completed',
      createdAt: '2026-05-31T08:01:30.000Z',
    });
    repository.saveRun({
      runId: 'run-current-path',
      sessionId: 'session-1',
      mode: 'default',
      goal: 'Current path run',
      status: 'failed',
      createdAt: '2026-05-31T08:03:30.000Z',
      error: {
        code: 'runtime_unknown',
        message: 'current-path-failed-run',
        severity: 'error',
        retryable: false,
        source: 'provider',
      },
    });
    repository.saveRun({
      runId: 'run-old-branch',
      sessionId: 'session-1',
      mode: 'default',
      goal: 'Old branch run',
      status: 'failed',
      createdAt: '2026-05-31T08:04:30.000Z',
      error: {
        code: 'runtime_unknown',
        message: 'old-branch-failed-run',
        severity: 'error',
        retryable: false,
        source: 'provider',
      },
    });
    repository.saveSessionCompaction({
      compactionId: 'compaction-old-branch',
      sessionId: 'session-1',
      summary: 'Old branch compaction must not be selected.',
      summaryKind: 'compaction',
      firstKeptSourceRef: sourceRef('session_message', 'message-old-branch-user'),
      tokensBefore: 10000,
      triggerReason: 'context_budget_pressure',
      status: 'completed',
      createdAt: '2026-05-31T08:10:00.000Z',
    });
    appendActivePath(activePathRepository, 'session-1', [
      { sourceEntryId: 'source-entry-root-user', sourceKind: 'session_message', sourceId: 'message-root-user', createdAt: '2026-05-31T08:01:00.000Z' },
      { sourceEntryId: 'source-entry-run-a', sourceKind: 'session_run', sourceId: 'run-a', createdAt: '2026-05-31T08:01:30.000Z' },
      { sourceEntryId: 'source-entry-assistant-a', sourceKind: 'session_message', sourceId: 'message-assistant-a', createdAt: '2026-05-31T08:02:00.000Z' },
      { sourceEntryId: 'source-entry-branch-marker', sourceKind: 'branch_marker', sourceId: 'branch-marker-current', createdAt: '2026-05-31T08:02:30.000Z' },
      { sourceEntryId: 'source-entry-current-user', sourceKind: 'session_message', sourceId: 'message-current-user', createdAt: '2026-05-31T08:03:00.000Z' },
      { sourceEntryId: 'source-entry-run-current-path', sourceKind: 'session_run', sourceId: 'run-current-path', createdAt: '2026-05-31T08:03:30.000Z' },
    ]);

    const input = new SessionContextInputService({ repository, activePathRepository }).buildSessionContextInput({
      sessionId: 'session-1',
      builtAt: '2026-05-31T08:11:00.000Z',
      maxHistoryEntries: 12,
      maxRuntimeFacts: 12,
    });

    expect(input.historyEntries?.map((entry) => entry.sourceRef.sourceId)).toEqual([
      'message-root-user',
      'message-assistant-a',
      'message-current-user',
    ]);
    expect(input.runtimeFacts?.map((fact) => fact.text)).toEqual([
      'Previous run failed before a final answer. Error: current-path-failed-run',
    ]);
    expect(input.runtimeFacts?.map((fact) => fact.sourceRef.sourceId)).toEqual([
      'run-current-path',
    ]);
    expect(input.summaryEntries).toBeUndefined();
    expect(JSON.stringify(input)).not.toContain('Old branch assistant answer');
    expect(JSON.stringify(input)).not.toContain('old-branch-failed-run');
    expect(JSON.stringify(input)).not.toContain('Old branch compaction');
  });

  it('uses latest active path completed compaction and keeps history from firstKeptSourceRef', () => {
    const { repository, activePathRepository } = createRepositories();
    repository.saveSession({
      sessionId: 'session-1',
      title: 'Session',
      status: 'active',
      summary: 'Legacy explicit summary must not override compaction.',
      createdAt: '2026-05-31T09:00:00.000Z',
      updatedAt: '2026-05-31T09:00:00.000Z',
    });
    for (const message of [
      ['message-1', 'user', 'Old user context before compaction.', '2026-05-31T09:01:00.000Z'],
      ['message-2', 'assistant', 'First kept assistant context.', '2026-05-31T09:02:00.000Z'],
      ['message-3', 'user', 'Post-compaction user request.', '2026-05-31T09:03:00.000Z'],
    ] as const) {
      saveCompletedMessage(repository, {
        messageId: message[0],
        role: message[1],
        content: message[2],
        createdAt: message[3],
      });
    }
    repository.saveSessionCompaction({
      compactionId: 'compaction-active',
      sessionId: 'session-1',
      summary: 'Latest active compaction summary.',
      summaryKind: 'compaction',
      firstKeptSourceRef: sourceRef('session_message', 'message-2'),
      tokensBefore: 9000,
      triggerReason: 'context_budget_pressure',
      status: 'completed',
      createdAt: '2026-05-31T09:02:30.000Z',
    });
    appendActivePath(activePathRepository, 'session-1', [
      { sourceEntryId: 'source-entry-message-1', sourceKind: 'session_message', sourceId: 'message-1', createdAt: '2026-05-31T09:01:00.000Z' },
      { sourceEntryId: 'source-entry-message-2', sourceKind: 'session_message', sourceId: 'message-2', createdAt: '2026-05-31T09:02:00.000Z' },
      { sourceEntryId: 'source-entry-compaction-active', sourceKind: 'session_summary', sourceId: 'compaction-active', createdAt: '2026-05-31T09:02:30.000Z' },
      { sourceEntryId: 'source-entry-message-3', sourceKind: 'session_message', sourceId: 'message-3', createdAt: '2026-05-31T09:03:00.000Z' },
    ]);

    const input = new SessionContextInputService({ repository, activePathRepository }).buildSessionContextInput({
      sessionId: 'session-1',
      builtAt: '2026-05-31T09:06:00.000Z',
      maxHistoryEntries: 12,
      maxRuntimeFacts: 12,
    });

    expect(input.summaryEntries?.[0]).toMatchObject({
      summaryId: 'session-compaction:compaction-active',
      summaryKind: 'compaction',
      sourceRef: {
        sourceKind: 'session_summary',
        sourceId: 'compaction-active',
      },
    });
    expect(input.historyEntries?.map((entry) => entry.sourceRef.sourceId)).toEqual([
      'message-2',
      'message-3',
    ]);
    expect(JSON.stringify(input.historyEntries)).not.toContain('Old user context before compaction.');
    expect(JSON.stringify(input.summaryEntries)).not.toContain('Legacy explicit summary');
  });

  it('retains summary and a small active path window when compaction boundary is unresolved', () => {
    const { repository, activePathRepository } = createRepositories();
    repository.saveSession({
      sessionId: 'session-1',
      title: 'Session',
      status: 'active',
      createdAt: '2026-05-31T10:00:00.000Z',
      updatedAt: '2026-05-31T10:00:00.000Z',
    });
    const activeEntries: Parameters<typeof appendActivePath>[2] = [];
    for (let index = 1; index <= 6; index += 1) {
      saveCompletedMessage(repository, {
        messageId: `message-${index}`,
        role: index % 2 === 0 ? 'assistant' : 'user',
        content: `Message ${index}`,
        createdAt: `2026-05-31T10:00:0${index}.000Z`,
      });
      activeEntries.push({
        sourceEntryId: `source-entry-message-${index}`,
        sourceKind: 'session_message',
        sourceId: `message-${index}`,
        createdAt: `2026-05-31T10:00:0${index}.000Z`,
      });
    }
    saveCompletedMessage(repository, {
      messageId: 'message-off-path',
      role: 'assistant',
      content: 'Off-path fallback message must not appear.',
      createdAt: '2026-05-31T10:00:09.000Z',
    });
    repository.saveSessionCompaction({
      compactionId: 'compaction-missing-boundary',
      sessionId: 'session-1',
      summary: 'Summary should still be retained when the boundary is missing.',
      summaryKind: 'compaction',
      firstKeptSourceRef: sourceRef('session_message', 'message-off-path'),
      tokensBefore: 12000,
      triggerReason: 'context_budget_pressure',
      status: 'completed',
      createdAt: '2026-05-31T10:01:00.000Z',
    });
    appendActivePath(activePathRepository, 'session-1', [
      ...activeEntries.slice(0, 3),
      { sourceEntryId: 'source-entry-compaction-missing-boundary', sourceKind: 'session_summary', sourceId: 'compaction-missing-boundary', createdAt: '2026-05-31T10:01:00.000Z' },
      ...activeEntries.slice(3),
    ]);

    const input = new SessionContextInputService({ repository, activePathRepository }).buildSessionContextInput({
      sessionId: 'session-1',
      builtAt: '2026-05-31T10:02:00.000Z',
      maxHistoryEntries: 10,
      maxRuntimeFacts: 10,
    });

    expect(input.summaryEntries?.map((entry) => [entry.summaryId, entry.summaryKind, entry.text])).toEqual([
      [
        'session-compaction:compaction-missing-boundary',
        'compaction',
        'Summary should still be retained when the boundary is missing.',
      ],
    ]);
    expect(input.historyEntries?.map((entry) => entry.sourceRef.sourceId)).toEqual([
      'message-3',
      'message-4',
      'message-5',
      'message-6',
    ]);
    expect(input.runtimeFacts).toEqual([
      expect.objectContaining({
        factId: 'compaction-missing-boundary:boundary-unresolved',
        factKind: 'other',
        severity: 'warning',
        text: 'Compaction boundary could not be resolved; retained latest compaction summary and a small recent history window.',
        sourceRef: expect.objectContaining({
          sourceId: 'compaction-missing-boundary:boundary-unresolved',
          sourceKind: 'session_summary',
          sourceUri: 'session-compaction://compaction-missing-boundary/boundary-unresolved',
          loadedAt: '2026-05-31T10:02:00.000Z',
        }),
      }),
    ]);
    expect(JSON.stringify(input)).not.toContain('Off-path fallback message');
  });
});

