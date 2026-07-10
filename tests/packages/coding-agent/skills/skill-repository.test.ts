// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type MegumiDatabase } from '@megumi/coding-agent/persistence/connection';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import { SkillRepository } from '@megumi/coding-agent/skills/repository/skill-repository';

describe('SkillRepository', () => {
  let database: MegumiDatabase;
  let repository: SkillRepository;

  beforeEach(() => {
    database = createDatabase(':memory:');
    applyCodingAgentDatabaseMigrations(database);
    seedWorkspaceSessionAndRun(database);
    repository = new SkillRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  it('inserts and updates availability for the same global skill row', () => {
    repository.saveAvailability({
      skillAvailabilityId: 'skill-availability:1',
      skillId: 'checks:test',
      available: false,
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    });
    const updated = repository.saveAvailability({
      skillAvailabilityId: 'skill-availability:2',
      skillId: 'checks:test',
      available: true,
      createdAt: '2026-07-09T01:00:00.000Z',
      updatedAt: '2026-07-09T01:00:00.000Z',
    });

    expect(updated).toEqual({
      skillAvailabilityId: 'skill-availability:1',
      skillId: 'checks:test',
      available: true,
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T01:00:00.000Z',
    });
    expect(repository.listAvailabilityByWorkspace({})).toHaveLength(1);
  });

  it('finds availability exactly and returns undefined without explicit rows', () => {
    expect(repository.findAvailability({ skillId: 'checks:test' })).toBeUndefined();
    repository.saveAvailability({
      skillAvailabilityId: 'skill-availability:1',
      skillId: 'checks:test',
      workspaceId: 'workspace:1',
      available: false,
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    });

    expect(repository.findAvailability({ skillId: 'checks:test' })).toBeUndefined();
    expect(repository.findAvailability({ skillId: 'checks:test', workspaceId: 'workspace:1' })?.available).toBe(false);
  });

  it('lists global and workspace availability rows relevant to a workspace', () => {
    repository.saveAvailability({
      skillAvailabilityId: 'skill-availability:global',
      skillId: 'global:skill',
      available: true,
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    });
    repository.saveAvailability({
      skillAvailabilityId: 'skill-availability:workspace',
      skillId: 'workspace:skill',
      workspaceId: 'workspace:1',
      available: false,
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    });
    repository.saveAvailability({
      skillAvailabilityId: 'skill-availability:other',
      skillId: 'other:skill',
      workspaceId: 'workspace:2',
      available: false,
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    });

    expect(repository.listAvailabilityByWorkspace({ workspaceId: 'workspace:1' }).map((row) => row.skillId)).toEqual([
      'global:skill',
      'workspace:skill',
    ]);
  });

  it('saves usage records as append-only facts without storing activated content', () => {
    repository.saveUsageRecord({
      skillUsageRecordId: 'skill-usage-record:1',
      skillId: 'checks:test',
      workspaceId: 'workspace:1',
      sessionId: 'session:1',
      runId: 'run:1',
      trigger: 'command',
      createdAt: '2026-07-09T00:00:00.000Z',
    });
    repository.saveUsageRecord({
      skillUsageRecordId: 'skill-usage-record:2',
      skillId: 'checks:test',
      workspaceId: 'workspace:1',
      sessionId: 'session:1',
      runId: 'run:1',
      trigger: 'model_tool',
      createdAt: '2026-07-09T00:01:00.000Z',
    });

    const records = repository.listUsageRecordsBySession('session:1');
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.trigger)).toEqual(['command', 'model_tool']);
    expect(Object.keys(records[0] ?? {})).not.toContain('content');
  });
});

function seedWorkspaceSessionAndRun(database: MegumiDatabase): void {
  database.prepare(`
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status,
      created_at, updated_at, last_opened_at
    ) VALUES (
      'workspace:1', 'Workspace', 'C:/workspace', 'c:/workspace', 'active',
      '2026-07-09T00:00:00.000Z', '2026-07-09T00:00:00.000Z', '2026-07-09T00:00:00.000Z'
    )
  `).run();
  database.prepare(`
    INSERT INTO sessions (
      session_id, workspace_id, title, status, active_entry_id,
      created_at, updated_at, archived_at
    ) VALUES (
      'session:1', 'workspace:1', 'Session', 'active', NULL,
      '2026-07-09T00:00:00.000Z', '2026-07-09T00:00:00.000Z', NULL
    )
  `).run();
  database.prepare(`
    INSERT INTO agent_runs (
      run_id, workspace_id, session_id, provider_id, model_id,
      trigger_type, trigger_user_message_id, trigger_command_name, status,
      created_at, started_at, completed_at, failure_json
    ) VALUES (
      'run:1', 'workspace:1', 'session:1', 'openai', 'gpt-test',
      'command', NULL, 'skill', 'completed',
      '2026-07-09T00:00:00.000Z', NULL, NULL, NULL
    )
  `).run();
}
