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

  it('connects the Electron UI shell to the Coding Agent product runtime', () => {
    const desktopComposition = source('apps/desktop/src/main/shell-composition/desktop-main-composition.ts');

    expect(desktopComposition).toContain('composeCodingAgentRuntime');
    expect(desktopComposition).toContain('providerService: codingAgentRuntime.providerSettingsService');
    expect(desktopComposition).toContain('sessionHandlers: { sessionService, sessionBranchService, agentRunService }');
    expect(desktopComposition).toContain('runHandlers: { sessionService, agentRunService }');
    expect(desktopComposition).toContain('runContextService: codingAgentRuntime.runContextService');
    expect(desktopComposition).toContain('toolService: codingAgentRuntime.toolService');
    expect(desktopComposition).not.toContain('new SessionRunService');
    expect(desktopComposition).not.toContain('new ProviderRuntimeService');
    expect(desktopComposition).not.toContain('new WorkspaceRestoreService');
    expect(desktopComposition).not.toContain('migrateDatabase');
  });

  it('keeps product runtime composition under packages/coding-agent', () => {
    const productComposition = source('packages/coding-agent/composition/compose-coding-agent-runtime.ts');
    const persistenceComposition = source('packages/coding-agent/composition/compose-coding-agent-persistence.ts');
    const sessionComposition = source('packages/coding-agent/composition/compose-coding-agent-session-runtime.ts');
    const toolComposition = source('packages/coding-agent/composition/compose-coding-agent-tool-runtime.ts');

    expect(productComposition).toContain('composeCodingAgentPersistence');
    expect(productComposition).toContain('composeCodingAgentToolRuntimeFactory');
    expect(productComposition).toContain('composeCodingAgentSessionRuntime');
    expect(productComposition).toContain('new ProviderSettingsService');
    expect(persistenceComposition).toContain('migrateDatabase(database)');
    expect(persistenceComposition).toContain('new SessionRunRepository(database)');
    expect(sessionComposition).toContain('new AgentRunService');
    expect(sessionComposition).toContain('new PermissionSnapshotService');
    expect(toolComposition).toContain('createToolCallRunner');
    expect(toolComposition).toContain('createToolExecutionRouter');
  });
});
