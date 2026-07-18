/* Verifies legacy Runtime Events are transactionally converted into Session-owned semantic history. */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '@megumi/agent/persistence/connection';
import {
  AgentDatabaseMigrationError,
  migrateAgentDatabase,
} from '@megumi/agent/persistence/schema';

const migrationsRoot = path.join(process.cwd(), 'packages/agent/persistence/migrations');
let tempRoot: string | undefined;

afterEach(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe('legacy Session history backfill', () => {
  it('rebuilds semantic Assistant and Tool Result messages in call order', () => {
    const fixture = createLegacyFixture();
    seedLegacyRun(fixture.database);
    fixture.database.close();

    const migrated = migrateAgentDatabase({
      sqliteDirectory: fixture.sqliteDirectory,
      migrationsFolder: migrationsRoot,
    });
    try {
      const messages = migrated.database.prepare(`
        WITH RECURSIVE active_path(entry_id, parent_entry_id, message_id, depth) AS (
          SELECT entry_id, parent_entry_id, message_id, 0 FROM session_entries
          WHERE entry_id = (SELECT active_entry_id FROM sessions WHERE session_id = 'session:1')
          UNION ALL
          SELECT parent.entry_id, parent.parent_entry_id, parent.message_id, child.depth + 1
          FROM session_entries parent JOIN active_path child ON parent.entry_id = child.parent_entry_id
        )
        SELECT message.message_id, message.run_id, message.role, message.message_json
        FROM active_path path JOIN session_messages message ON message.message_id = path.message_id
        ORDER BY path.depth DESC
      `).all() as Array<{ message_id: string; run_id: string; role: string; message_json: string }>;
      expect(messages.map((message) => message.role)).toEqual([
        'user', 'assistant', 'toolResult', 'toolResult', 'assistant',
      ]);
      expect(messages.every((message) => message.run_id === 'run:1')).toBe(true);
      expect(messages.slice(1, 4).map((message) => JSON.parse(message.message_json))).toMatchObject([
        { role: 'assistant', content: [
          { type: 'text', text: 'Checking.' },
          { type: 'toolCall', id: 'tool:1', name: 'read_file' },
          { type: 'toolCall', id: 'tool:2', name: 'search_text' },
        ] },
        { role: 'toolResult', toolCallId: 'tool:1', status: 'success' },
        { role: 'toolResult', toolCallId: 'tool:2', status: 'failure' },
      ]);
      expect(JSON.parse(messages.at(-1)!.message_json)).toMatchObject({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Need summarize.' },
          { type: 'text', text: 'Done.' },
        ],
      });

      const chain = migrated.database.prepare(`
        WITH RECURSIVE active_path(entry_id, parent_entry_id, message_id) AS (
          SELECT entry_id, parent_entry_id, message_id FROM session_entries
          WHERE entry_id = (SELECT active_entry_id FROM sessions WHERE session_id = 'session:1')
          UNION ALL
          SELECT parent.entry_id, parent.parent_entry_id, parent.message_id
          FROM session_entries parent JOIN active_path child ON parent.entry_id = child.parent_entry_id
        )
        SELECT message_id FROM active_path
      `).all() as Array<{ message_id: string }>;
      expect(new Set(chain.map((entry) => entry.message_id))).toEqual(new Set(messages.map((message) => message.message_id)));
      expect(tableExists(migrated.database, 'agent_run_runtime_events')).toBe(false);
      expect(tableExists(migrated.database, 'agent_runs')).toBe(false);
      expect(migrated.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect((migrated.database.prepare(`PRAGMA foreign_key_list(artifacts)`).all() as Array<{ from: string; table: string }>))
        .toContainEqual(expect.objectContaining({ from: 'current_version_id', table: 'artifact_versions' }));
    } finally {
      migrated.database.close();
    }
  });

  it('rolls back staging and preserves legacy tables when a payload is malformed', () => {
    const fixture = createLegacyFixture();
    seedLegacyRun(fixture.database, true);
    fixture.database.close();

    expect(() => migrateAgentDatabase({
      sqliteDirectory: fixture.sqliteDirectory,
      migrationsFolder: migrationsRoot,
    })).toThrow(AgentDatabaseMigrationError);

    const database = createDatabase(path.join(fixture.sqliteDirectory, 'megumi.sqlite3'));
    try {
      expect(tableExists(database, 'agent_runs')).toBe(true);
      expect(tableExists(database, 'agent_run_runtime_events')).toBe(true);
      expect((database.prepare(`SELECT COUNT(*) AS count FROM session_messages`).get() as { count: number }).count)
        .toBe(2);
      expect(tableExists(database, 'legacy_session_message_staging')).toBe(false);
    } finally {
      database.close();
    }
  });

  it('attaches a cancelled partial Assistant message as the active leaf when no final message exists', () => {
    const fixture = createLegacyFixture();
    seedLegacyRun(fixture.database);
    fixture.database.exec(`
      UPDATE sessions SET active_entry_id = 'entry:user' WHERE session_id = 'session:1';
      DELETE FROM session_entries WHERE entry_id = 'entry:final';
      DELETE FROM session_messages WHERE message_id = 'message:final';
      DELETE FROM agent_run_runtime_events;
      UPDATE agent_runs SET status = 'cancelled', completed_at = '2026-07-12T00:00:03.000Z' WHERE run_id = 'run:1';
    `);
    fixture.database.prepare(`
      INSERT INTO agent_run_runtime_events (
        event_id, run_id, session_id, event_type, sequence, created_at, source, visibility, persist, payload_json
      ) VALUES ('event:partial', 'run:1', 'session:1', 'model_call.completed', 1,
        '2026-07-12T00:00:01.000Z', 'agent_run', 'ui', 'persist', ?)
    `).run(JSON.stringify({
      modelCallId: 'model:partial',
      finishReason: 'cancelled',
      content: [{ type: 'text', text: 'Partial answer' }],
    }));
    fixture.database.close();

    const migrated = migrateAgentDatabase({
      sqliteDirectory: fixture.sqliteDirectory,
      migrationsFolder: migrationsRoot,
    });
    try {
      const active = migrated.database.prepare(`
        SELECT message.role, message.message_json
        FROM sessions session
        JOIN session_entries entry ON entry.entry_id = session.active_entry_id
        JOIN session_messages message ON message.message_id = entry.message_id
        WHERE session.session_id = 'session:1'
      `).get() as { role: string; message_json: string };
      expect(active.role).toBe('assistant');
      expect(JSON.parse(active.message_json)).toMatchObject({
        role: 'assistant',
        content: [{ type: 'text', text: 'Partial answer' }],
        stopReason: 'cancelled',
      });
    } finally {
      migrated.database.close();
    }
  });

  it('fills a partially migrated run and remains idempotent on the next startup', () => {
    const fixture = createLegacyFixture();
    seedLegacyRun(fixture.database);
    fixture.database.exec(`
      INSERT INTO session_messages (
        message_id, session_id, run_id, role, content_text, message_json, created_at, completed_at
      ) VALUES (
        'legacy:assistant:run:1:model:1', 'session:1', 'run:1', 'assistant', 'Checking.',
        '{"role":"assistant","content":[{"type":"text","text":"Checking."},{"type":"toolCall","id":"tool:1","name":"read_file","argumentsText":"{\\"path\\":\\"a.ts\\"}"},{"type":"toolCall","id":"tool:2","name":"search_text","argumentsText":"{\\"query\\":\\"x\\"}"}],"stopReason":"tool_calls"}',
        '2026-07-12T00:00:01.000Z', '2026-07-12T00:00:01.000Z'
      );
      INSERT INTO session_entries (
        entry_id, session_id, parent_entry_id, entry_type, message_id, compaction_id, created_at
      ) VALUES (
        'legacy:entry:legacy:assistant:run:1:model:1', 'session:1', 'entry:user', 'message',
        'legacy:assistant:run:1:model:1', NULL, '2026-07-12T00:00:01.000Z'
      );
      UPDATE session_entries
      SET parent_entry_id = 'legacy:entry:legacy:assistant:run:1:model:1'
      WHERE entry_id = 'entry:final';
    `);
    fixture.database.close();

    const first = migrateAgentDatabase({ sqliteDirectory: fixture.sqliteDirectory, migrationsFolder: migrationsRoot });
    expect((first.database.prepare(`SELECT COUNT(*) AS count FROM session_messages`).get() as { count: number }).count)
      .toBe(5);
    first.database.close();

    const second = migrateAgentDatabase({ sqliteDirectory: fixture.sqliteDirectory, migrationsFolder: migrationsRoot });
    try {
      expect((second.database.prepare(`SELECT COUNT(*) AS count FROM session_messages`).get() as { count: number }).count)
        .toBe(5);
    } finally {
      second.database.close();
    }
  });

  it('retains an orphaned Tool Result as a semantic fact before the final Assistant message', () => {
    const fixture = createLegacyFixture();
    seedLegacyRun(fixture.database);
    fixture.database.prepare(`DELETE FROM agent_run_runtime_events WHERE event_id = 'event:call2'`).run();
    fixture.database.close();

    const migrated = migrateAgentDatabase({ sqliteDirectory: fixture.sqliteDirectory, migrationsFolder: migrationsRoot });
    try {
      const path = migrated.database.prepare(`
        WITH RECURSIVE active_path(entry_id, parent_entry_id, message_id, depth) AS (
          SELECT entry_id, parent_entry_id, message_id, 0 FROM session_entries
          WHERE entry_id = (SELECT active_entry_id FROM sessions WHERE session_id = 'session:1')
          UNION ALL
          SELECT parent.entry_id, parent.parent_entry_id, parent.message_id, child.depth + 1
          FROM session_entries parent JOIN active_path child ON parent.entry_id = child.parent_entry_id
        )
        SELECT message.message_json FROM active_path path
        JOIN session_messages message ON message.message_id = path.message_id
        ORDER BY path.depth DESC
      `).all() as Array<{ message_json: string }>;
      const conversations = path.map((row) => JSON.parse(row.message_json) as { role: string; toolCallId?: string });
      expect(conversations).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'toolResult', toolCallId: 'tool:2' }),
      ]));
      expect(conversations.at(-1)).toMatchObject({ role: 'assistant' });
    } finally {
      migrated.database.close();
    }
  });
});

function createLegacyFixture() {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-legacy-backfill-'));
  const sqliteDirectory = path.join(tempRoot, 'sqlite');
  const legacyMigrations = path.join(tempRoot, 'migrations');
  fs.mkdirSync(path.join(legacyMigrations, 'meta'), { recursive: true });
  for (const name of [
    '0000_database_foundation_redesign.sql',
    '0001_skill_system.sql',
    '0002_semantic_session_messages.sql',
  ]) {
    fs.copyFileSync(path.join(migrationsRoot, name), path.join(legacyMigrations, name));
  }
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsRoot, 'meta/_journal.json'), 'utf8')) as {
    entries: unknown[];
  };
  fs.writeFileSync(path.join(legacyMigrations, 'meta/_journal.json'), JSON.stringify({
    ...journal,
    entries: journal.entries.slice(0, 3),
  }));
  return {
    sqliteDirectory,
    database: migrateAgentDatabase({ sqliteDirectory, migrationsFolder: legacyMigrations }).database,
  };
}

function seedLegacyRun(database: ReturnType<typeof createDatabase>, malformed = false): void {
  const now = '2026-07-12T00:00:00.000Z';
  database.exec(`
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status, created_at, updated_at, last_opened_at
    ) VALUES ('workspace:1', 'Workspace', '/workspace', '/workspace', 'available', '${now}', '${now}', '${now}');
    INSERT INTO sessions (
      session_id, workspace_id, title, status, active_entry_id, created_at, updated_at, archived_at
    ) VALUES ('session:1', 'workspace:1', 'Session', 'active', NULL, '${now}', '${now}', NULL);
    INSERT INTO session_messages (
      message_id, session_id, run_id, role, content_text, message_json, created_at, completed_at
    ) VALUES
      ('message:user', 'session:1', 'run:1', 'user', 'Please inspect',
       '{"role":"user","content":[{"type":"text","text":"Please inspect"}]}', '${now}', '${now}'),
      ('message:final', 'session:1', 'run:1', 'assistant', 'Done.',
       '{"role":"assistant","content":[{"type":"text","text":"Done."}],"stopReason":"stop"}', '2026-07-12T00:00:09.000Z', '2026-07-12T00:00:09.000Z');
    INSERT INTO session_entries (
      entry_id, session_id, parent_entry_id, entry_type, message_id, compaction_id, created_at
    ) VALUES
      ('entry:user', 'session:1', NULL, 'message', 'message:user', NULL, '${now}'),
      ('entry:final', 'session:1', 'entry:user', 'message', 'message:final', NULL, '2026-07-12T00:00:09.000Z');
    UPDATE sessions SET active_entry_id = 'entry:final' WHERE session_id = 'session:1';
    INSERT INTO agent_runs (
      run_id, workspace_id, session_id, provider_id, model_id, trigger_type,
      trigger_user_message_id, trigger_command_name, status, created_at, started_at, completed_at, failure_json
    ) VALUES ('run:1', 'workspace:1', 'session:1', 'provider', 'model', 'user_input',
      'message:user', NULL, 'completed', '${now}', '${now}', '2026-07-12T00:00:09.000Z', NULL);
  `);

  const events = malformed ? [
    ['event:bad', 'model_call.tool_call', 1, '{"modelCallId":"model:1"}'],
  ] : [
    ['event:call1', 'model_call.tool_call', 1, JSON.stringify({ modelCallId: 'model:1', toolCallId: 'tool:1', toolName: 'read_file', input: { path: 'a.ts' } })],
    ['event:call2', 'model_call.tool_call', 2, JSON.stringify({ modelCallId: 'model:1', toolCallId: 'tool:2', toolName: 'search_text', input: { query: 'x' } })],
    ['event:model1', 'model_call.completed', 3, JSON.stringify({ modelCallId: 'model:1', finishReason: 'tool_calls', content: [{ type: 'text', text: 'Checking.' }] })],
    ['event:result2', 'tool_result.created', 4, JSON.stringify({ toolResultId: 'result:2', toolCallId: 'tool:2', toolName: 'search_text', kind: 'failed', content: [{ type: 'text', text: 'missing' }] })],
    ['event:result1', 'tool_result.created', 5, JSON.stringify({ toolResultId: 'result:1', toolCallId: 'tool:1', toolName: 'read_file', kind: 'success', content: [{ type: 'text', text: 'file' }] })],
    ['event:thinking2', 'model.thinking.delta', 6, JSON.stringify({ modelStepId: 'model:2', delta: 'Need summarize.' })],
    ['event:model2', 'model_call.completed', 7, JSON.stringify({ modelCallId: 'model:2', finishReason: 'stop', content: [{ type: 'text', text: 'Done.' }] })],
  ];
  const insert = database.prepare(`
    INSERT INTO agent_run_runtime_events (
      event_id, run_id, session_id, event_type, sequence, created_at, source, visibility, persist, payload_json
    ) VALUES (?, 'run:1', 'session:1', ?, ?, ?, 'agent_run', 'ui', 'persist', ?)
  `);
  for (const [eventId, eventType, sequence, payload] of events) {
    insert.run(eventId, eventType, sequence, `2026-07-12T00:00:0${sequence}.000Z`, payload);
  }
}

function tableExists(database: ReturnType<typeof createDatabase>, table: string): boolean {
  return Boolean(database.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table));
}
