// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createMemorySources } from '@megumi/application/coding/sessions/memory-sources';
import type { MemorySourceResult } from '@megumi/application/memory/source-contracts';
import { createDatabase } from '@megumi/application/storage/index';
import { createSourceFixture } from './source-fixture';

function found(result: MemorySourceResult) {
  if (result.status !== 'found') throw new Error(JSON.stringify(result));

  return result.snapshot;
}

it('distinguishes unavailable storage from a missing source', () => {
  const f = createSourceFixture();
  const sources = createMemorySources({
    store: f.store,
    isSessionRunning: () => false,
  });

  expect(sources.readSnapshot('absent')).toEqual({ status: 'notFound' });

  f.database.close();

  expect(sources.readSnapshot('s1')).toMatchObject({
    status: 'failed',
    error: { code: 'STORAGE_FAILED' },
  });
});

it('keeps original evidence through compaction and metadata edits, and resolves an old branch after a switch', async () => {
  const f = createSourceFixture();
  const sources = createMemorySources({
    store: f.store,
    isSessionRunning: () => false,
  });

  try {
    await f.user('u1');

    const reply = f.reply('a1');
    const before = found(sources.readSnapshot('s1'));
    f.database
      .prepare({
        sql: "UPDATE sessions SET title = 'Renamed', updated_at = '2026-10-05' WHERE session_id = 's1'",
      })
      .run();
    f.store.archiveSession({
      session_id: 's1',
      archived_at: '2026-10-05',
    });
    f.store.insertCompaction({
      compactionId: 'c1',
      sessionId: 's1',
      anchorEntryId: reply.entry_id,
      trigger: 'manual',
      status: 'completed',
      startedAt: '2026-10-06',
      completedAt: '2026-10-06',
      summary: {
        compaction_id: 'c1',
        session_id: 's1',
        summary_text: 'A short summary',
        covered_until_entry_id: reply.entry_id,
        created_at: '2026-10-06',
      },
    });
    f.store.insertEntry({
      entry_id: 'entry:c1',
      session_id: 's1',
      entry_type: 'compaction',
      compaction_id: 'c1',
      created_at: '2026-10-06',
    });
    f.store.updateSessionActiveEntry({
      session_id: 's1',
      active_entry_id: 'entry:c1',
      updated_at: '2026-10-06',
    });

    expect(found(sources.readSnapshot('s1'))).toEqual(before);
    expect(sources.listSources()[0]).toMatchObject({
      title: 'Renamed',
      archived: true,
      contentUpdatedAt: before.contentUpdatedAt,
    });

    await f.user('alternate', 'New branch', 'entry:u1');

    const alternate = found(sources.readSnapshot('s1'));

    expect(alternate.sourceVersion).not.toBe(before.sourceVersion);
    expect(alternate.messages.map(message => message.message_id)).toEqual(['u1', 'alternate']);

    const original = sources.readSource(before.sourceRef);

    expect(original).toMatchObject({
      status: 'found',
      sourceChanged: true,
      snapshot: before,
    });
    expect(before.messages.map(message => message.message_id)).toEqual(['u1', 'a1']);
    expect(sources.readSource('invalid')).toMatchObject({
      status: 'failed',
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(sources.readSnapshot('absent')).toEqual({ status: 'notFound' });
  } finally {
    f.database.close();
  }
});

it('returns one snapshot when a second connection commits during reading, and resumes replies after reopen', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'memory-source-'));
  const filename = path.join(directory, 'test.sqlite');
  const f = createSourceFixture(filename);
  // WAL permits another connection to commit while the source holds its read snapshot.
  f.database.prepare({ sql: 'PRAGMA journal_mode = WAL' }).get();
  const other = createDatabase({ filename });

  try {
    await f.user('u1');
    f.reply('a1');
    const sources = createMemorySources({
      store: f.store,
      isSessionRunning: () => false,
    });
    const before = found(sources.readSnapshot('s1'));
    const listEntries = f.store.listEntriesBySessionId.bind(f.store);
    vi.spyOn(f.store, 'listEntriesBySessionId').mockImplementationOnce(sessionId => {
      other
        .prepare({
          sql: "UPDATE sessions SET active_entry_id = 'entry:u1', content_updated_at = '2026-10-07' WHERE session_id = 's1'",
        })
        .run();
      return listEntries(sessionId);
    });

    expect(found(sources.readSnapshot('s1'))).toEqual(before);
    expect(found(sources.readSnapshot('s1')).sourceVersion).not.toBe(before.sourceVersion);

    const cursor = sources.getReplyCursor();

    expect(
      sources
        .listReplies({
          afterCursor: 0,
          limit: 20,
        })
        .map(reply => reply.message.message_id),
    ).toEqual(['a1']);

    f.database.close();
    const reopened = createSourceFixture(filename);

    try {
      reopened.reply('a2');
      const resumed = createMemorySources({
        store: reopened.store,
        isSessionRunning: () => true,
      });

      expect(
        resumed
          .listReplies({
            afterCursor: cursor,
            limit: 20,
          })
          .map(reply => reply.message.message_id),
      ).toEqual(['a2']);
      expect(resumed.listSources()[0].running).toBe(true);
    } finally {
      reopened.database.close();
    }
  } finally {
    other.close();
    f.database.close();
    rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
});

it('changes the content version when saved attachment metadata changes and rejects missing original evidence', async () => {
  const f = createSourceFixture();

  try {
    await f.user('u1');

    const sources = createMemorySources({
      store: f.store,
      isSessionRunning: () => false,
    });
    const before = found(sources.readSnapshot('s1'));
    f.store.insertMessageAttachments([
      {
        attachment_id: 'file1',
        session_id: 's1',
        message_id: 'u1',
        type: 'file',
        source_type: 'local_file',
        source_value: 'C:/unread.txt',
        ordinal: 0,
        created_at: '2026-10-02',
      },
    ]);

    expect(found(sources.readSnapshot('s1')).sourceVersion).not.toBe(before.sourceVersion);
    expect(sources.readSource(before.sourceRef)).toMatchObject({
      status: 'failed',
      error: { code: 'SOURCE_UNAVAILABLE' },
    });

    f.database.prepare({ sql: "DELETE FROM session_messages WHERE message_id = 'u1'" }).run();

    expect(sources.readSnapshot('s1')).toMatchObject({
      status: 'failed',
      error: { code: 'SOURCE_UNAVAILABLE' },
    });
  } finally {
    f.database.close();
  }
});
