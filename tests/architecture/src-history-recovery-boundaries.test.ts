import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('src history recovery boundaries', () => {
  it('does not leave Plan 4 history operations as unavailable', () => {
    const sessionHandler = read('src/desktop/ipc/session.handler.ts');
    const runHandler = read('src/desktop/ipc/run.handler.ts');
    const recoveryHandler = read('src/desktop/ipc/recovery.handler.ts');

    expect(sessionHandler).not.toContain("operation === 'session.branchDraft.create') throw unavailable");
    expect(sessionHandler).not.toContain("operation === 'session.branchDraft.cancel') throw unavailable");
    expect(runHandler).not.toContain("operation === 'run.events.list') throw unavailable");
    expect(recoveryHandler).not.toContain("operation === 'recovery.listRecoverableRuns') throw unavailable");
    expect(recoveryHandler).toContain("operation === 'recovery.restoreWorkspaceChangeSet'");
    expect(recoveryHandler).toContain('workspace restore repository adapter is not implemented');
  });

  it('keeps desktop history adapters outside Agent Loop internals', () => {
    const files = [
      'src/desktop/ipc/session.handler.ts',
      'src/desktop/ipc/run.handler.ts',
      'src/desktop/ipc/recovery.handler.ts',
      'src/desktop/renderer-protocol/history.mapper.ts',
    ].map(read).join('\n');

    expect(files).not.toContain('buildModelContextInput');
    expect(files).not.toContain('streamAssistantMessage');
    expect(files).not.toContain('preflightToolCall');
    expect(files).not.toContain('evaluatePermissionPolicy');
    expect(files).not.toContain('createAgentRunner');
  });

  it('keeps Plan 6 entrypoints while leaving Plan E owner modules delayed', () => {
    expect(read('forge.config.ts')).toContain('src/desktop/main.ts');
    expect(read('forge.config.ts')).toContain('src/desktop/preload/index.ts');
    expect(read('vite.main.config.ts')).toContain("path.resolve(__dirname, 'src/desktop')");
    expect(read('vite.preload.config.ts')).toContain("path.resolve(__dirname, 'src/desktop')");
    expect(read('vite.renderer.config.ts')).toContain("root: 'src/ui'");

    const recoveryHandler = read('src/desktop/ipc/recovery.handler.ts');
    expect(recoveryHandler).not.toContain('restoreChangeSet(');
    expect(recoveryHandler).not.toContain('WorkspaceChangeRepository');
  });
});
