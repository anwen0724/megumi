/* Verifies the Session Owner has the confirmed concept-oriented package boundary. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as PublicSession from '../../../packages/agent/session/src/index';

const repoRoot = join(__dirname, '../../..');
const exists = (filePath: string) => existsSync(join(repoRoot, filePath));
const read = (filePath: string) => readFileSync(join(repoRoot, filePath), 'utf8');

describe('Session package boundary', () => {
  it('uses only the confirmed concept-oriented source files', () => {
    for (const filePath of [
      'packages/agent/session/package.json',
      'packages/agent/session/tsconfig.json',
      'packages/agent/session/src/index.ts',
      'packages/agent/session/src/session.ts',
      'packages/agent/session/src/session-message.ts',
      'packages/agent/session/src/session-catalog.ts',
      'packages/agent/session/src/session-history.ts',
      'packages/agent/session/src/session-entry-graph.ts',
      'packages/agent/session/src/session-branch-drafts.ts',
      'packages/agent/session/src/session-attachment.ts',
      'packages/agent/session/src/session-store.ts',
    ]) expect(exists(filePath)).toBe(true);

    expect(exists('packages/agent/session/src/service')).toBe(false);
    expect(exists('packages/agent/session/src/repository')).toBe(false);
    expect(exists('packages/agent/session/src/config')).toBe(false);
  });

  it('keeps concrete implementations, SQL mapping, and graph helpers out of the public entry', () => {
    expect(PublicSession).not.toHaveProperty('DefaultSessionCatalog');
    expect(PublicSession).not.toHaveProperty('DefaultSessionHistory');
    expect(PublicSession).not.toHaveProperty('DefaultSessionEntryGraph');
    expect(PublicSession).not.toHaveProperty('buildActivePath');
    expect(PublicSession).not.toHaveProperty('createSessionStore');
    expect(PublicSession).not.toHaveProperty('createSessionAttachmentFileStore');

    const source = read('packages/agent/session/src/index.ts');
    expect(source).not.toContain('SessionService');
    expect(source).not.toContain('DefaultSession');
    expect(source).not.toContain('buildActivePath');
    expect(source).not.toContain('SessionRow');
  });

  it('depends only on the allowed Owner packages and keeps SQL in SessionStore', () => {
    const packageJson = read('packages/agent/session/package.json');
    expect(packageJson).toContain('@megumi/ai');
    expect(packageJson).toContain('@megumi/database');
    expect(packageJson).toContain('@megumi/events');
    expect(packageJson).not.toContain('@megumi/engine');
    expect(packageJson).not.toContain('@megumi/product-host');

    const store = read('packages/agent/session/src/session-store.ts');
    for (const table of [
      'sessions',
      'session_messages',
      'session_entries',
      'session_message_attachments',
      'session_compactions',
    ]) expect(store).toContain(table);
    expect(store).not.toContain('workspaces');
    expect(store).not.toContain('workspace_changes');
    expect(store).not.toContain('better-sqlite3');
    expect(store).not.toContain('drizzle-orm');
  });
});
