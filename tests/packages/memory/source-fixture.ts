/* Builds persisted source histories through Coding's existing public operations. */
import { createDatabase, migrateDatabase } from '@megumi/application/storage/index';
import { createSessionStore } from '@megumi/application/coding/sessions/session-storage';
import { createSessionHistory } from '@megumi/application/coding/sessions/session-history';

export function createSourceFixture(filename = ':memory:') {
  const database = createDatabase({ filename });
  migrateDatabase({ database });
  database.prepare({ sql: `INSERT OR IGNORE INTO workspaces VALUES
    ('w1', 'test', 'C:/memory-test', 'c:/memory-test', 'available', '2026-10-01', '2026-10-01', '2026-10-01')` }).run();
  const store = createSessionStore({ database });
  if (!store.findSessionById('s1')) store.insertSession({ session_id: 's1', workspace_id: 'w1',
    title: 'Original', status: 'active', created_at: '2026-10-01', updated_at: '2026-10-01' });
  const history = createSessionHistory({ store,
    ids: { entryId: ({ source_id }) => `entry:${source_id}` } });
  return { database, store, history,
    async user(id: string, text = id, parent?: string) {
      const saved = await history.saveUserMessage({ session_id: 's1', message_id: id,
        display_content: [{ type: 'text', text }], model_content: [{ type: 'text', text }],
        parent_entry_id: parent, created_at: `2026-10-02T00:00:00.000Z` });
      if (saved.status !== 'saved') throw new Error(saved.failure.message);
      return saved.entry;
    },
    reply(id: string) {
      const saved = history.saveAssistantReply({ session_id: 's1', message_id: id, execution_id: id,
        status: 'completed', content: [{ type: 'text', text: id }], completed_at: '2026-10-03T00:00:00.000Z' });
      if (saved.status !== 'saved') throw new Error(saved.failure.message);
      return saved.entry;
    },
  };
}
