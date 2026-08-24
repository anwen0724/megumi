// @vitest-environment node
/* Verifies Product startup closes Session-owned Compaction records left running by an earlier process. */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '@megumi/database';
import type { ProductCapabilitiesOptions } from '@megumi/desktop/main/shell-composition/harness-capabilities';
import { createSessionCatalog, createSessionHistory } from '@megumi/session';
import { createSessionStore } from '@megumi/session/store';
import { createNodeWorkspaceFileSystem } from '@megumi/workspace/node';
import { composeTestProduct } from './compose-test-product';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Product Compaction startup recovery', () => {
  it('marks a prior running Compaction as interrupted before startup completes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'megumi-compaction-recovery-'));
    tempDirectories.push(root);
    const homePath = join(root, 'home');
    const workspaceRoot = join(root, 'workspace');
    mkdirSync(workspaceRoot);
    const options = productOptions(root, homePath, workspaceRoot);

    const initialProduct = composeTestProduct(options);
    await initialProduct.dispose();

    const database = createDatabase({ filename: join(homePath, 'sqlite', 'megumi.sqlite') });
    const store = createSessionStore({ database });
    database.prepare({ sql: `
      INSERT INTO workspaces (
        workspace_id, name, root_path, root_path_key, status,
        created_at, updated_at, last_opened_at
      ) VALUES (
        'workspace:recovery', 'Recovery', '${workspaceRoot.replaceAll("'", "''")}',
        'workspace:recovery', 'available',
        '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z'
      )
    ` }).run();
    const sessions = createSessionCatalog({
      store,
      ids: { sessionId: () => 'session:recovery' },
      now: () => '2026-08-08T00:00:00.000Z',
    });
    const history = createSessionHistory({
      store,
      ids: { entryId: ({ kind, source_id }) => `${kind}:${source_id}` },
    });
    sessions.createSession({ workspace_id: 'workspace:recovery', title: 'Recovery' });
    const message = await history.saveUserMessage({
      message_id: 'message:recovery',
      session_id: 'session:recovery',
      display_content: [{ type: 'text', text: 'hello' }],
      model_content: [{ type: 'text', text: 'hello' }],
      created_at: '2026-08-08T00:01:00.000Z',
    });
    expect(message.status).toBe('saved');
    if (message.status !== 'saved') return;
    expect(history.beginCompaction({
      compactionId: 'compaction:recovery',
      sessionId: 'session:recovery',
      anchorEntryId: message.entry.entry_id,
      trigger: 'manual',
      startedAt: '2026-08-08T00:02:00.000Z',
    }).status).toBe('started');
    database.close();

    const recoveredProduct = composeTestProduct(options);
    await recoveredProduct.dispose();

    const recoveredDatabase = createDatabase({ filename: join(homePath, 'sqlite', 'megumi.sqlite') });
    try {
      const recoveredHistory = createSessionHistory({
        store: createSessionStore({ database: recoveredDatabase }),
      });
      expect(recoveredHistory.getActiveConversationHistory({ session_id: 'session:recovery' })).toMatchObject({
        status: 'ok',
        conversation: [
          { type: 'message', message: { message_id: 'message:recovery' } },
          {
            type: 'compaction',
            compactionId: 'compaction:recovery',
            status: 'interrupted',
            error: { code: 'runtime_interrupted' },
          },
        ],
      });
    } finally {
      recoveredDatabase.close();
    }
  });
});

function productOptions(root: string, homePath: string, workspaceRoot: string): ProductCapabilitiesOptions {
  let settings: Record<string, unknown> = {};
  return {
    home: {
      env: { MEGUMI_HOME: homePath },
      homeDirectory: root,
      fileSystem: {
        ensureDirSync: fs.ensureDirSync,
        pathExistsSync: fs.pathExistsSync,
        writeJsonSync: fs.writeJsonSync,
        writeFileSync: fs.writeFileSync,
        copyDirectorySync: fs.copySync,
      },
      clock: { now: () => new Date('2026-08-08T00:00:00.000Z') },
    },
    workspaceFileSystem: createNodeWorkspaceFileSystem(),
    settingsStorage: {
      read: () => settings,
      write: (next) => { settings = next; },
    },
  };
}
