/*
 * Protects the stable Workspace Package surface and excludes concrete adapters from it.
 */
import { describe, expect, it } from 'vitest';
import * as workspacePackage from '../../../packages/workspace/src/index';
import type {
  WorkspaceCatalog,
  WorkspaceChanges,
  WorkspaceFiles,
  WorkspacePathPolicy,
  WorkspaceStore,
} from '../../../packages/workspace/src/index';

describe('Workspace Package contracts', () => {
  it('exposes distinct capability contracts without Service synonyms', () => {
    const contracts = {} as {
      catalog: WorkspaceCatalog;
      pathPolicy: WorkspacePathPolicy;
      files: WorkspaceFiles;
      changes: WorkspaceChanges;
      store: WorkspaceStore;
    };
    expect(contracts).toBeDefined();
    expect('createWorkspaceService' in workspacePackage).toBe(false);
    expect('createWorkspaceChangeService' in workspacePackage).toBe(false);
  });

  it('does not export concrete Store or Node filesystem implementations by default', () => {
    expect('createWorkspaceStore' in workspacePackage).toBe(false);
    expect('createNodeWorkspaceFileSystem' in workspacePackage).toBe(false);
  });
});
