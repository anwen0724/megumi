/*
 * Protects lexical and canonical Workspace path boundaries across platforms.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROTECTED_WORKSPACE_PATHS,
  DEFAULT_SENSITIVE_WORKSPACE_PATHS,
  createWorkspacePathPolicy,
} from '../../../packages/agent/workspace/src/index';

describe('WorkspacePathPolicy', () => {
  const policy = createWorkspacePathPolicy();
  const workspaceRoot = 'C:/workspaces/megumi';

  it('normalizes Windows paths and rejects traversal', () => {
    expect(policy.classifyPath({
      workspace_root: workspaceRoot,
      target_path: 'src\\index.ts',
      platform: 'win32',
    })).toMatchObject({
      workspace_path: 'src/index.ts',
      inside_workspace: true,
      protected: false,
      sensitive: false,
    });
    expect(policy.assertOrdinaryPath({
      workspace_root: workspaceRoot,
      target_path: '../outside.txt',
      platform: 'win32',
    })).toEqual({ status: 'rejected', reason: 'outside_workspace' });
  });

  it('keeps protected and sensitive path facts explicit', () => {
    expect(DEFAULT_PROTECTED_WORKSPACE_PATHS.directories).toContain('.git');
    expect(DEFAULT_SENSITIVE_WORKSPACE_PATHS).toContain('.env.*');
    expect(policy.assertOrdinaryPath({ workspace_root: '/workspace', target_path: '.git/config' }))
      .toEqual({ status: 'rejected', reason: 'protected_path' });
    expect(policy.assertOrdinaryPath({ workspace_root: '/workspace', target_path: '.env.local' }))
      .toEqual({ status: 'rejected', reason: 'sensitive_path' });
  });

  it('rejects an existing symlink that resolves outside the Workspace', async () => {
    const result = await policy.resolveCanonicalPath({
      workspace_root: '/workspace',
      target_path: 'linked/secret.txt',
      platform: 'linux',
      file_system: {
        async realpath(target) {
          if (target === '/workspace') return '/workspace';
          if (target === '/workspace/linked/secret.txt') return '/outside/secret.txt';
          throw new Error('missing');
        },
      },
    });

    expect(result).toEqual({ status: 'outside_workspace', target_path: 'linked/secret.txt' });
  });

  it('rejects a new path beneath a symlinked directory outside the Workspace', async () => {
    const result = await policy.resolveCanonicalPath({
      workspace_root: '/workspace',
      target_path: 'linked/new.txt',
      platform: 'linux',
      file_system: {
        async realpath(target) {
          if (target === '/workspace') return '/workspace';
          if (target === '/workspace/linked') return '/outside';
          throw new Error('missing');
        },
      },
    });

    expect(result).toEqual({ status: 'outside_workspace', target_path: 'linked/new.txt' });
  });
  it('canonicalizes an external path without treating it as a Workspace path', async () => {
    const result = await policy.classifyCanonicalPath({
      workspace_root: '/workspace',
      target_path: '../outside/new.txt',
      platform: 'linux',
      file_system: {
        async realpath(target) {
          if (target === '/workspace') return '/workspace';
          if (target === '/outside') return '/canonical-outside';
          throw new Error('missing');
        },
      },
    });

    expect(result).toMatchObject({
      absolute_path: '/canonical-outside/new.txt',
      inside_workspace: false,
      protected: false,
      sensitive: false,
    });
  });
});
