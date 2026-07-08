import { describe, expect, it } from 'vitest';
import { createDatabase, type MegumiDatabase } from '@megumi/coding-agent/persistence/connection';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import {
  createAgentRunRepository,
  type AgentRunRepository,
} from '@megumi/coding-agent/agent-run/repositories/agent-run-repository';
import type { AgentRun, AgentRunApprovalRequest } from '@megumi/coding-agent/agent-run';
import type { RuntimeEvent } from '@megumi/coding-agent/events';

describe('AgentRunRepository', () => {
  it('persists AgentRun with architecture-owned fields only', () => {
    withDatabase((database) => {
      seedWorkspaceAndSession(database);
      const repository = createAgentRunRepository({ database });
      const run = sampleRun();

      repository.createRun(run);

      expect(repository.getRun(run.run_id)).toEqual(run);
      expect(columns(database, 'agent_runs')).toEqual([
        'run_id',
        'workspace_id',
        'session_id',
        'provider_id',
        'model_id',
        'trigger_type',
        'trigger_user_message_id',
        'trigger_command_name',
        'status',
        'created_at',
        'started_at',
        'completed_at',
        'failure_json',
      ]);
    });
  });

  it('updates run lifecycle fields and lists interrupted runs', () => {
    withDatabase((database) => {
      seedWorkspaceAndSession(database);
      const repository = createAgentRunRepository({ database });
      const running = sampleRun({ run_id: 'run-running', status: 'running' });
      const waiting = sampleRun({ run_id: 'run-waiting', status: 'waiting_for_approval' });
      const cancelling = sampleRun({ run_id: 'run-cancelling', status: 'cancelling' });
      const completed = sampleRun({ run_id: 'run-completed', status: 'completed' });

      for (const run of [running, waiting, cancelling, completed]) {
        repository.createRun(run);
      }

      repository.saveRun({
        ...running,
        status: 'failed',
        completed_at: '2026-01-01T00:01:00.000Z',
        failure: {
          code: 'runtime_interrupted',
          message: 'Runtime interrupted.',
        },
      });

      expect(repository.getRun(running.run_id)).toMatchObject({
        status: 'failed',
        failure: { code: 'runtime_interrupted' },
      });
      expect(repository.listInterruptedRuns().map((run) => run.run_id).sort()).toEqual([
        'run-cancelling',
        'run-waiting',
      ]);
    });
  });

  it('persists approval requests with architecture-owned fields only', () => {
    withDatabase((database) => {
      seedWorkspaceAndSession(database);
      const repository = createAgentRunRepository({ database });
      repository.createRun(sampleRun());
      const approval = sampleApprovalRequest();

      repository.createApprovalRequest(approval);

      expect(repository.getApprovalRequest(approval.approval_request_id)).toEqual(approval);
      expect(columns(database, 'agent_run_approval_requests')).toEqual([
        'approval_request_id',
        'run_id',
        'subject_json',
        'status',
        'created_at',
        'decided_at',
        'decision_json',
      ]);
    });
  });

  it('updates approval request status and lists pending requests by run', () => {
    withDatabase((database) => {
      seedWorkspaceAndSession(database);
      const repository = createAgentRunRepository({ database });
      repository.createRun(sampleRun());
      const pending = sampleApprovalRequest({ approval_request_id: 'approval-pending' });
      const approved = sampleApprovalRequest({ approval_request_id: 'approval-approved' });

      repository.createApprovalRequest(pending);
      repository.createApprovalRequest(approved);
      repository.saveApprovalRequest({
        ...approved,
        status: 'approved',
        decided_at: '2026-01-01T00:02:00.000Z',
        decision: {
          approval_request_id: approved.approval_request_id,
          decision: 'approved',
          scope: 'once',
          decided_by: 'user',
          decided_at: '2026-01-01T00:02:00.000Z',
        },
      });

      expect(repository.listPendingApprovalRequestsByRun('run-1')).toEqual([pending]);
    });
  });

  it('persists and replays run-scoped runtime events in sequence order', () => {
    withDatabase((database) => {
      seedWorkspaceAndSession(database);
      const repository = createAgentRunRepository({ database });
      repository.createRun(sampleRun());

      const later = sampleRuntimeEvent({
        eventId: 'event-2',
        eventType: 'model_call.text_delta',
        sequence: 2,
        payload: {
          modelCallId: 'model-call-1',
          delta: 'world',
        },
      });
      const earlier = sampleRuntimeEvent({
        eventId: 'event-1',
        eventType: 'run.started',
        sequence: 1,
        payload: {
          runKind: 'agent',
          providerId: 'deepseek',
          modelId: 'deepseek-chat',
        },
      });

      repository.saveRuntimeEvent(later);
      repository.saveRuntimeEvent(earlier);
      repository.saveRuntimeEvent({ ...earlier, eventId: 'event-without-run', runId: undefined });
      database.prepare(`
        INSERT INTO agent_run_runtime_events (
          event_id, run_id, session_id, event_type, sequence, created_at, source, visibility, persist, payload_json
        ) VALUES (
          'event-invalid', 'run-1', 'session-1', 'model_call.text_delta', 3,
          '2026-01-01T00:00:03.000Z', 'core', 'user', 'required', '{}'
        )
      `).run();

      expect(repository.listRuntimeEventsByRun('run-1').map((event) => event.eventId)).toEqual([
        'event-1',
        'event-2',
      ]);
      expect(repository.nextRuntimeEventSequence('run-1')).toBe(4);
      expect(repository.nextRuntimeEventSequence('run-missing')).toBe(1);
      expect(columns(database, 'agent_run_runtime_events')).toEqual([
        'event_id',
        'run_id',
        'session_id',
        'event_type',
        'sequence',
        'created_at',
        'source',
        'visibility',
        'persist',
        'payload_json',
      ]);
    });
  });

  it('keeps Agent Run business persistence out of legacy persistence repos', () => {
    expect(() => require('@megumi/coding-agent/persistence/repos/agent-run.repo')).toThrow();
  });
});

function withDatabase(test: (database: MegumiDatabase) => void): void {
  const database = createDatabase(':memory:');
  try {
    applyCodingAgentDatabaseMigrations(database);
    test(database);
  } finally {
    database.close();
  }
}

function seedWorkspaceAndSession(database: MegumiDatabase): void {
  database.prepare(`
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status, created_at, updated_at, last_opened_at
    ) VALUES (
      'workspace-1', 'Workspace', 'C:/workspace', 'workspace-key', 'active',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    )
  `).run();
  database.prepare(`
    INSERT INTO sessions (
      session_id, workspace_id, title, status, created_at, updated_at
    ) VALUES (
      'session-1', 'workspace-1', 'Session', 'active',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    )
  `).run();
  database.prepare(`
    INSERT INTO session_messages (
      message_id, session_id, run_id, role, content_text, created_at
    ) VALUES (
      'message-1', 'session-1', NULL, 'user', 'hello', '2026-01-01T00:00:00.000Z'
    )
  `).run();
}

function sampleRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    run_id: 'run-1',
    workspace_id: 'workspace-1',
    session_id: 'session-1',
    model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    trigger: { type: 'user_input', user_message_id: 'message-1' },
    status: 'queued',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function sampleApprovalRequest(
  overrides: Partial<AgentRunApprovalRequest> = {},
): AgentRunApprovalRequest {
  return {
    approval_request_id: 'approval-1',
    run_id: 'run-1',
    subject: {
      type: 'tool_call',
      tool_call_id: 'tool-call-1',
      tool_name: 'run_command',
      input: { command: 'npm test' },
    },
    status: 'pending',
    created_at: '2026-01-01T00:00:30.000Z',
    ...overrides,
  };
}

function sampleRuntimeEvent(overrides: Partial<RuntimeEvent> = {}): RuntimeEvent {
  return {
    eventId: 'event-1',
    schemaVersion: 1,
    eventType: 'run.started',
    runId: 'run-1',
    sessionId: 'session-1',
    requestId: 'request-1',
    sequence: 1,
    createdAt: '2026-01-01T00:00:01.000Z',
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: {
      runKind: 'agent',
    },
    ...overrides,
  };
}

function columns(database: MegumiDatabase, tableName: string): string[] {
  return (database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>).map((row) => row.name);
}
