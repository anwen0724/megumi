// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('Desktop Main shell composition', () => {
  it('does not keep product composition modules under desktop main', () => {
    expect(existsSync(join(root, 'apps/desktop/src/main/composition'))).toBe(false);
    expect(existsSync(join(root, 'apps/desktop/src/main/persistence'))).toBe(false);
  });

  it('connects the Electron UI shell through the Coding Agent host interface', () => {
    const desktopComposition = source('apps/desktop/src/main/shell-composition/desktop-main-composition.ts');

    expect(desktopComposition).toContain('composeCodingAgentHostInterface');
    expect(desktopComposition).toContain('workspace: { host: codingAgentHost, workspaceFilesService }');
    expect(desktopComposition).toContain('chat: { host: codingAgentHost }');
    expect(desktopComposition).toContain('settings: { host: codingAgentHost }');
    expect(desktopComposition).toContain('approval: { host: codingAgentHost }');
    expect(desktopComposition).toContain('artifact: codingAgentHost.artifacts');
    expect(desktopComposition).not.toContain('runHandlers:');
    expect(desktopComposition).not.toContain('runContextService:');
    expect(desktopComposition).not.toContain('toolService:');
    expect(desktopComposition).not.toContain('providerService:');
    expect(desktopComposition).not.toContain('settingsService:');
    expect(desktopComposition).not.toContain('sessionHandlers:');
    expect(desktopComposition).not.toContain('recoveryService:');
    expect(desktopComposition).not.toContain('new SessionRunService');
    expect(desktopComposition).not.toContain('new ProviderRuntimeService');
    expect(desktopComposition).not.toContain('new WorkspaceRestoreService');
    expect(desktopComposition).not.toContain('migrateDatabase');
  });

});
