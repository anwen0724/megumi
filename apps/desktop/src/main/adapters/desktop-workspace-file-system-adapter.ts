/* Provides the Desktop Host Adapter for Product Workspace filesystem access. */

import type { ProductWorkspaceFileSystem } from '@megumi/application/contracts';
import { createNodeWorkspaceFileSystem } from '@megumi/application/workspace/node-workspace-file-system';

export function createDesktopWorkspaceFileSystem(): ProductWorkspaceFileSystem {
  return createNodeWorkspaceFileSystem();
}
