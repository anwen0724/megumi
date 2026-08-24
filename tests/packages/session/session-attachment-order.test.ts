/* Verifies attachment submission order survives a real Database close and reopen. */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSessionCatalog,
  createSessionHistory,
} from '../../../packages/agent/session/src/index';
import { createSessionStore } from '@megumi/session/store';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '../../../packages/agent/database/src/index';

let temporaryRoot: string | undefined;

afterEach(() => {
  if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

describe('Session attachment order', () => {
  it('keeps mixed image and document attachments in submission order after reopen', async () => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-session-order-'));
    const filename = path.join(temporaryRoot, 'megumi.sqlite3');
    const firstDatabase = createDatabase({ filename });
    migrateDatabase({ database: firstDatabase });
    seedWorkspace(firstDatabase);

    const attachmentIds = ['attachment:z', 'attachment:a', 'attachment:y', 'attachment:b'];
    const content = new Map<string, Uint8Array>();
    const contentStore = {
      async write(input: { attachmentId: string; bytes: Uint8Array }) {
        const referenceId = `${input.attachmentId}/original.png`;
        content.set(referenceId, input.bytes);
        return { referenceId };
      },
      async read(referenceId: string) {
        const bytes = content.get(referenceId);
        if (!bytes) throw new Error('missing');
        return bytes;
      },
      async delete(referenceId: string) { content.delete(referenceId); },
    };
    const firstStore = createSessionStore({ database: firstDatabase });
    const catalog = createSessionCatalog({
      store: firstStore,
      ids: { sessionId: () => 'session:order' },
      now: () => '2026-07-20T00:00:00.000Z',
    });
    const history = createSessionHistory({
      store: firstStore,
      ids: {
        entryId: ({ kind, source_id }) => `${kind}:${source_id}`,
        attachmentId: () => attachmentIds.shift()!,
      },
      attachmentContentStore: contentStore,
    });

    expect(catalog.createSession({
      workspace_id: 'workspace:order',
      title: 'Attachment order',
    }).status).toBe('created');
    expect((await history.saveUserMessage({
      message_id: 'message:order',
      session_id: 'session:order',
      display_content: [{ type: 'text', text: 'mixed attachments' }], model_content: [{ type: 'text', text: 'mixed attachments' }],
      attachments: [
        file('first.pdf', 'C:/documents/first.pdf'),
        image('second.png', 2),
        file('third.txt', 'C:/documents/third.txt'),
        image('fourth.png', 4),
      ],
      created_at: '2026-07-20T00:01:00.000Z',
    })).status).toBe('saved');
    firstDatabase.close();

    const reopenedDatabase = createDatabase({ filename });
    try {
      expect(migrateDatabase({ database: reopenedDatabase }).appliedMigrations).toBe(0);
      const reopenedHistory = createSessionHistory({
        store: createSessionStore({ database: reopenedDatabase }),
      });
      const result = reopenedHistory.listMessages({ session_id: 'session:order' });

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.messages[0]?.attachments.map((attachment) => ({
          name: attachment.name,
          ordinal: attachment.ordinal,
        }))).toEqual([
          { name: 'first.pdf', ordinal: 0 },
          { name: 'second.png', ordinal: 1 },
          { name: 'third.txt', ordinal: 2 },
          { name: 'fourth.png', ordinal: 3 },
        ]);
      }
    } finally {
      reopenedDatabase.close();
    }
  });
});

function seedWorkspace(database: DatabaseConnection): void {
  database.prepare({ sql: `
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status,
      created_at, updated_at, last_opened_at
    ) VALUES (
      'workspace:order', 'Order', 'C:/workspace/order', 'c:/workspace/order', 'available',
      '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'
    )
  ` }).run();
}

function image(name: string, byte: number) {
  return {
    type: 'image' as const,
    name,
    media_type: 'image/png' as const,
    byte_length: 1,
    bytes: new Uint8Array([byte]),
  };
}

function file(name: string, localPath: string) {
  return {
    type: 'file' as const,
    name,
    media_type: 'application/octet-stream',
    local_path: localPath,
    size_bytes: 1,
  };
}
