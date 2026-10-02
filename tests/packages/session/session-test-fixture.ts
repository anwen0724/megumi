/* Creates isolated, real Session and Workspace storage for behavior tests. */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/application/storage/index';
import { createSessionCatalog, createSessionHistory } from '@megumi/agent-runtime/sessions/index';
import { createSessionStore } from '@megumi/application/storage/session-store';
import { createSessionAttachmentFileStore } from '@megumi/application/storage/session-attachment-store';
import { createWorkspaceCatalog } from '@megumi/application/workspace/index';
import { createWorkspaceStore } from '@megumi/application/workspace/workspace-store';

export const savedAt = '2026-07-31T00:00:00.000Z';

/** Opens an isolated workspace and session through their public capabilities. */
export async function createSessionFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'megumi-session-behavior-'));
  const workspaceRoot = path.join(root, 'workspace');
  mkdirSync(workspaceRoot);
  const filename = path.join(root, 'session.sqlite');
  let database: DatabaseConnection;
  try { database = createDatabase({ filename }); }
  catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  try {
    migrateDatabase({ database });
    const workspaceCatalog = createWorkspaceCatalog({
      store: createWorkspaceStore({ database }), file_system: { stat },
    });
    const opened = await workspaceCatalog.openWorkspace({ root_path: workspaceRoot });
    if (opened.status !== 'opened') throw new Error('Test workspace could not be opened');
    const workspaceId = opened.workspace.workspace_id;
    const store = createSessionStore({ database });
    const catalog = createSessionCatalog({ store });
    const contentStore = createSessionAttachmentFileStore({
      attachmentsPath: path.join(root, 'attachments'),
      fileSystem: {
        ensureDirectory: async directory => { await mkdir(directory, { recursive: true }); },
        writeFile,
        moveFile: rename,
        readFile,
        removeFile: filename => rm(filename, { force: true }),
      },
    });
    const history = createSessionHistory({ store, attachmentContentStore: contentStore });
    const created = catalog.createSession({ workspace_id: workspaceId });
    if (created.status !== 'created') throw new Error('Test session could not be created');
    return {
      root, workspaceRoot, workspaceId, workspaceCatalog, filename, database, store, catalog, history, contentStore,
      sessionId: created.session.session_id,
      cleanup() {
        database.close();
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    database.close();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
