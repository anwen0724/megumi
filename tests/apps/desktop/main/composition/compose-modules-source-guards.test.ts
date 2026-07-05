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
    expect(desktopComposition).toContain('providerService: codingAgentHost.settings.provider');
    expect(desktopComposition).toContain('settingsService: codingAgentHost.settings');
    expect(desktopComposition).toContain('sessionHandlers: { host: codingAgentHost }');
    expect(desktopComposition).toContain('permissionsService: codingAgentHost.permissions');
    expect(desktopComposition).toContain('projectService: codingAgentHost.workspace');
    expect(desktopComposition).not.toContain('runHandlers:');
    expect(desktopComposition).not.toContain('runContextService:');
    expect(desktopComposition).not.toContain('toolService:');
    expect(desktopComposition).not.toContain('recoveryService:');
    expect(desktopComposition).not.toContain('new SessionRunService');
    expect(desktopComposition).not.toContain('new ProviderRuntimeService');
    expect(desktopComposition).not.toContain('new WorkspaceRestoreService');
    expect(desktopComposition).not.toContain('migrateDatabase');
  });

  it('keeps Coding Agent product composition under packages/coding-agent', () => {
    const productComposition = source('packages/coding-agent/composition/compose-coding-agent-runtime.ts');
    const persistenceComposition = source('packages/coding-agent/composition/compose-coding-agent-persistence.ts');
    const sessionComposition = source('packages/coding-agent/composition/compose-coding-agent-session-runtime.ts');
    const toolComposition = source('packages/coding-agent/composition/compose-coding-agent-tool-runtime.ts');

    expect(productComposition).toContain('composeCodingAgentPersistence');
    expect(productComposition).toContain('createAgentRunService');
    expect(productComposition).toContain('composeCodingAgentToolExecutionService');
    expect(productComposition).toContain('new SessionV2Repository(persistence.database)');
    expect(productComposition).toContain('createSettingsService');
    expect(persistenceComposition).toContain('migrateCodingAgentDatabase');
    expect(persistenceComposition).toContain('workspaceRepository: new WorkspaceRepository(database)');
    expect(persistenceComposition).toContain('sessionRepository: new SessionRepository(database)');
    expect(persistenceComposition).toContain('agentLoopRepository: new AgentLoopRepository(database)');
    expect(persistenceComposition).toContain('toolCallRepository: new ToolCallRepository(database)');
    expect(persistenceComposition).not.toContain('new SessionRunRepository(database)');
    expect(productComposition).toContain('createInputService');
    expect(productComposition).toContain('createPermissionService');
    expect(toolComposition).toContain('createToolCallRunner');
    expect(toolComposition).toContain('new ToolExecutionService');
    expect(toolComposition).toContain('createBuiltInToolAdapter');
    expect(toolComposition).not.toContain('createToolExecutionRouter');
  });
});
