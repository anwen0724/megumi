/* Provides the Desktop Host Adapter for Product Workspace filesystem access. */

import type { ProductWorkspaceFileSystem } from '@megumi/product';
import { createNodeWorkspaceFileSystem } from '@megumi/workspace/node';

export function createDesktopWorkspaceFileSystem(): ProductWorkspaceFileSystem {
  return createNodeWorkspaceFileSystem();
}
