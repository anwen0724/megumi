import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROTECTED_WORKSPACE_PATHS,
  DEFAULT_SENSITIVE_WORKSPACE_PATHS,
} from '@megumi/coding-agent/workspace/core/workspace-path-policy';
import { createWorkspacePathPolicyService } from '@megumi/coding-agent/workspace/services/workspace-path-policy-service';

describe('WorkspacePathPolicyService', () => {
  const service = createWorkspacePathPolicyService();
  const workspace_root = 'C:/workspaces/megumi';

  it('classifies workspace-local paths', () => {
    expect(service.classifyPath({
      workspace_root,
      target_path: 'src\\index.ts',
      platform: 'win32',
    })).toMatchObject({
      workspace_path: 'src/index.ts',
      inside_workspace: true,
      protected: false,
      sensitive: false,
    });
  });

  it('classifies outside paths', () => {
    expect(service.classifyPath({
      workspace_root,
      target_path: '../outside.txt',
      platform: 'win32',
    })).toMatchObject({
      inside_workspace: false,
      protected: false,
      sensitive: false,
    });
  });

  it('detects protected workspace paths', () => {
    expect(DEFAULT_PROTECTED_WORKSPACE_PATHS.directories).toEqual([
      '.git',
      '.vscode',
      '.idea',
      '.husky',
      '.megumi',
    ]);
    expect(DEFAULT_PROTECTED_WORKSPACE_PATHS.files).toEqual([
      '.gitconfig',
      '.gitmodules',
      '.ripgreprc',
      '.mcp.json',
      '.megumi.json',
    ]);
    expect(service.classifyPath({ workspace_root, target_path: '.git/config' }).protected).toBe(true);
    expect(service.classifyPath({ workspace_root, target_path: '.megumi/settings.json' }).protected).toBe(true);
    expect(service.classifyPath({ workspace_root, target_path: '.mcp.json' }).protected).toBe(true);
  });

  it('detects sensitive workspace paths', () => {
    expect(DEFAULT_SENSITIVE_WORKSPACE_PATHS).toEqual([
      '.env',
      '.env.*',
      'secrets/**',
      '*.pem',
      '*.key',
      'id_rsa',
      'id_ed25519',
    ]);
    expect(service.classifyPath({ workspace_root, target_path: '.env' }).sensitive).toBe(true);
    expect(service.classifyPath({ workspace_root, target_path: '.env.local' }).sensitive).toBe(true);
    expect(service.classifyPath({ workspace_root, target_path: 'secrets/api.key' }).sensitive).toBe(true);
    expect(service.classifyPath({ workspace_root, target_path: 'cert.pem' }).sensitive).toBe(true);
  });

  it('resolves and rejects ordinary path validation as structured results', () => {
    expect(service.resolvePath({
      workspace_root,
      target_path: 'src/index.ts',
    })).toMatchObject({
      status: 'resolved',
      workspace_path: 'src/index.ts',
    });
    expect(service.assertOrdinaryPath({ workspace_root, target_path: '../outside.txt' })).toEqual({
      status: 'rejected',
      reason: 'outside_workspace',
    });
    expect(service.assertOrdinaryPath({ workspace_root, target_path: '.git/config' })).toEqual({
      status: 'rejected',
      reason: 'protected_path',
    });
    expect(service.assertOrdinaryPath({ workspace_root, target_path: '.env' })).toEqual({
      status: 'rejected',
      reason: 'sensitive_path',
    });
  });
});
