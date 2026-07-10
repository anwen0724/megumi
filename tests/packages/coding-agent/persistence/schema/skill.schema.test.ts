// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDatabase, type MegumiDatabase } from '@megumi/coding-agent/persistence/connection';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';

describe('Skill persistence schema', () => {
  it('creates skill_availability and skill_usage_record tables with confirmed columns', () => {
    const database = createMigratedDatabase();
    try {
      expect(tables(database)).toEqual(expect.arrayContaining([
        'skill_availability',
        'skill_usage_record',
      ]));
      expect(columns(database, 'skill_availability')).toEqual([
        'skill_availability_id',
        'skill_id',
        'workspace_id',
        'available',
        'created_at',
        'updated_at',
      ]);
      expect(columns(database, 'skill_usage_record')).toEqual([
        'skill_usage_record_id',
        'skill_id',
        'workspace_id',
        'session_id',
        'run_id',
        'trigger_kind',
        'created_at',
      ]);
    } finally {
      database.close();
    }
  });

  it('keeps usage record foreign keys on session and run only', () => {
    const database = createMigratedDatabase();
    try {
      expect(foreignKeys(database, 'skill_usage_record')).toEqual(expect.arrayContaining([
        {
          from: 'session_id',
          table: 'sessions',
          to: 'session_id',
          onDelete: 'CASCADE',
        },
        {
          from: 'run_id',
          table: 'agent_runs',
          to: 'run_id',
          onDelete: 'SET NULL',
        },
      ]));
    } finally {
      database.close();
    }
  });
});

function createMigratedDatabase(): MegumiDatabase {
  const database = createDatabase(':memory:');
  applyCodingAgentDatabaseMigrations(database);
  return database;
}

function tables(database: MegumiDatabase): string[] {
  return (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
    name: string;
  }>).map((row) => row.name);
}

function columns(database: MegumiDatabase, tableName: string): string[] {
  return (database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>).map((row) => row.name);
}

function foreignKeys(database: MegumiDatabase, tableName: string): Array<{
  from: string;
  table: string;
  to: string;
  onDelete: string;
}> {
  return (database.prepare(`PRAGMA foreign_key_list(${tableName})`).all() as Array<{
    from: string;
    table: string;
    to: string;
    on_delete: string;
  }>).map((row) => ({
    from: row.from,
    table: row.table,
    to: row.to,
    onDelete: row.on_delete,
  }));
}
