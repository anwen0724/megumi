/*
 * Public Workspace path policy service. It resolves and classifies paths under
 * a workspace root and reports ordinary validation failures as structured data.
 */
import type {
  AssertOrdinaryWorkspacePathRequest,
  AssertOrdinaryWorkspacePathResult,
  ResolveWorkspacePathRequest,
  ResolveWorkspacePathResult,
  WorkspacePathClassification,
  WorkspacePathPolicyService,
} from '../contracts/workspace-contracts';
import { classifyWorkspacePath } from '../core/workspace-path-policy';

export function createWorkspacePathPolicyService(): WorkspacePathPolicyService {
  return {
    classifyPath(request) {
      return classifyWorkspacePath(request) satisfies WorkspacePathClassification;
    },

    resolvePath(request: ResolveWorkspacePathRequest): ResolveWorkspacePathResult {
      const classification = classifyWorkspacePath(request);
      if (!classification.inside_workspace) {
        return { status: 'outside_workspace', target_path: request.target_path };
      }
      return {
        status: 'resolved',
        absolute_path: classification.absolute_path,
        workspace_path: classification.workspace_path,
        protected: classification.protected,
        sensitive: classification.sensitive,
      };
    },

    assertOrdinaryPath(request: AssertOrdinaryWorkspacePathRequest): AssertOrdinaryWorkspacePathResult {
      const classification = classifyWorkspacePath(request);
      if (!classification.inside_workspace) {
        return { status: 'rejected', reason: 'outside_workspace' };
      }
      if (classification.protected) {
        return { status: 'rejected', reason: 'protected_path' };
      }
      if (classification.sensitive) {
        return { status: 'rejected', reason: 'sensitive_path' };
      }
      return {
        status: 'ok',
        absolute_path: classification.absolute_path,
        workspace_path: classification.workspace_path,
      };
    },
  };
}
