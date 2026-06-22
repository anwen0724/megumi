import { describe, expect, it } from 'vitest';
import {
  classifyProjectPath,
  DEFAULT_PROTECTED_PATHS,
  DEFAULT_SENSITIVE_PATHS,
} from '@megumi/coding-agent/permissions/project-boundary-policy';

describe('project-boundary-policy', () => {
  const projectRoot = 'C:/all/work/study/megumi';

  it('classifies project-local normal paths', () => {
    expect(classifyProjectPath({ projectRoot, targetPath: 'src/index.ts' })).toMatchObject({
      insideProject: true,
      protected: false,
      sensitive: false,
    });
  });

  it('detects project escape, protected paths, and sensitive paths', () => {
    expect(classifyProjectPath({ projectRoot, targetPath: '../outside.txt' }).insideProject).toBe(false);
    expect(classifyProjectPath({ projectRoot, targetPath: '.git/config' }).protected).toBe(true);
    expect(classifyProjectPath({ projectRoot, targetPath: '.megumi/settings.json' }).protected).toBe(true);
    expect(classifyProjectPath({ projectRoot, targetPath: '.env' }).sensitive).toBe(true);
    expect(classifyProjectPath({ projectRoot, targetPath: 'secrets/api.key' }).sensitive).toBe(true);
  });

  it('documents default protected and sensitive patterns', () => {
    expect(DEFAULT_PROTECTED_PATHS.directories).toEqual(['.git', '.vscode', '.idea', '.husky', '.megumi']);
    expect(DEFAULT_SENSITIVE_PATHS).toContain('*.pem');
  });
});
