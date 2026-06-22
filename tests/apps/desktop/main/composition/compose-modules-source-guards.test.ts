// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const compositionRoot = join(root, 'apps', 'desktop', 'src', 'main', 'composition');

function readComposition(fileName: string): string {
  return readFileSync(join(compositionRoot, fileName), 'utf8');
}

describe('Desktop Main composition modules', () => {
  it('keeps desktop persistence on Megumi Home sqlite path with repository construction', () => {
    const source = readFileSync(
      join(root, 'apps', 'desktop', 'src', 'main', 'persistence', 'compose-desktop-persistence.ts'),
      'utf8',
    );

    expect(source).toContain("path.join(megumiHomePaths.sqlitePath, 'megumi.sqlite3')");
    expect(source).toContain('migrateDatabase(database)');
    expect(source).toContain('new SessionRunRepository(database)');
    expect(source).toContain('new PermissionSnapshotRepository(database)');
    expect(source).toContain('new WorkspaceChangeRepository(database)');
    expect(source).not.toContain(['app.getPath(', "'userData'", ')'].join(''));
    expect(source).not.toContain('BrowserWindow');
  });

  it('keeps provider runtime composition behind app settings', () => {
    const source = readComposition('compose-provider-runtime.ts');

    expect(source).toContain('new ProviderSettingsService');
    expect(source).toContain('settings: appSettingsService');
    expect(source).toContain('new ProviderRuntimeService');
    expect(source).toContain('createModelStepProviderService(providerRuntimeService)');
    expect(source).not.toContain('createElectronSecretStoreService');
  });

  it('keeps memory runtime composition wired to provider, logger, and markdown sync', () => {
    const source = readComposition('compose-memory-runtime.ts');

    expect(source).toContain('MemoryExtractionModelClientService');
    expect(source).toContain('modelStepProvider: options.modelStepProvider');
    expect(source).toContain('MemoryMarkdownSyncService');
    expect(source).toContain('syncUserMirrorOnAppStart');
    expect(source).toContain('MemoryRecallRuntimeService');
    expect(source).toContain('MemoryRuntimeCaptureService');
    expect(source).toContain("options.runtimeLogger.warn('memory_user_markdown_startup_sync_failed'");
    expect(source).toContain('createMemoryService');
  });

  it('keeps tool runtime composition wired through registry, permission settings, and workspace change tracking', () => {
    const source = readComposition('compose-tool-runtime.ts');

    expect(source).toContain('createBuiltInToolRegistry');
    expect(source).toContain('WorkspaceChangeTrackerService');
    expect(source).toContain('createToolOrchestratorService');
    expect(source).toContain('createToolExecutionRouter');
    expect(source).toContain('createBuiltInToolSourceExecutor');
    expect(source).toContain('createExternalTestToolSourceExecutor');
    expect(source).toContain('permissionSettingsService.loadForProject(projectRoot)');
    expect(source).toContain('new ToolService');
  });

  it('keeps project and workspace file composition on desktop host adapters', () => {
    const source = readComposition('compose-project-workspace.ts');

    expect(source).toContain('dialogHost.chooseDirectory');
    expect(source).toContain('shellHost.openPath');
    expect(source).toContain('createProjectService');
    expect(source).toContain('createWorkspaceFilesService');
    expect(source).toContain('createWorkspaceRootAuthorizer');
    expect(source).toContain('sessionSource: input.sessionRunService');
    expect(source).toContain('projectSource: input.projectService');
    expect(source).not.toContain("from 'electron'");
  });

  it('keeps session runtime composition wired to run context, permission snapshots, projections, and memory ports', () => {
    const source = readComposition('compose-session-runtime.ts');

    expect(source).toContain('new SessionRunService');
    expect(source).toContain('createDefaultRunContextService');
    expect(source).toContain('new PermissionSnapshotService');
    expect(source).toContain('new ToolRegistrySnapshotService');
    expect(source).toContain('new TimelineHistoryCommitProjectorService');
    expect(source).toContain('createWorkspaceChangeFooterProjectorService');
    expect(source).toContain('memoryRecallService: options.memoryRuntime.recallService');
    expect(source).toContain('memoryMarkdownSyncService: options.memoryRuntime.markdownSyncService');
    expect(source).toContain('windowHost.getAllWindows');
    expect(source).not.toContain("from 'electron'");
  });

  it('keeps recovery composition responsible for workspace restore and footer publishing glue', () => {
    const source = readComposition('compose-recovery-runtime.ts');

    expect(source).toContain('createRecoveryService');
    expect(source).toContain('new WorkspaceRestoreService');
    expect(source).toContain('appendRuntimeEvent');
    expect(source).toContain('workspace.change.footer.updated');
    expect(source).toContain('nextPersistedRuntimeSequence');
    expect(source).toContain('workspaceChangeRepository.getChangeSet');
    expect(source).toContain('Workspace restore requires workspacePath');
  });
});
