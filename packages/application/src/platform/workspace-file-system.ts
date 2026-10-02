/* Defines the host-provided filesystem interface required by Product Workspace composition. */

import type {
  WorkspaceCanonicalPathFileSystem,
  WorkspaceCatalogFileSystem,
  WorkspaceFilesFileSystem,
} from '../workspace/index';

export type ProductWorkspaceFileSystem = WorkspaceCatalogFileSystem
  & WorkspaceCanonicalPathFileSystem
  & WorkspaceFilesFileSystem;
