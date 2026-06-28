// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveMemoryRecallEffectiveCwd,
  resolveModelCallEffectiveCwd,
} from '@megumi/coding-agent/context';

describe('resolveModelCallEffectiveCwd', () => {
  it('defaults to the project root when no requested cwd is provided', () => {
    const projectRoot = path.resolve('C:/all/work/study/megumi');

    expect(resolveModelCallEffectiveCwd({ projectRoot })).toEqual({
      absolutePath: projectRoot,
      projectRelativePath: '.',
    });
  });

  it('accepts project-relative cwd inside the project boundary', () => {
    const projectRoot = path.resolve('C:/all/work/study/megumi');

    expect(resolveModelCallEffectiveCwd({
      projectRoot,
      requestedCwd: 'packages/context-management',
    })).toEqual({
      absolutePath: path.resolve(projectRoot, 'packages/context-management'),
      projectRelativePath: 'packages/context-management',
    });
  });

  it('accepts absolute cwd inside the project boundary', () => {
    const projectRoot = path.resolve('C:/all/work/study/megumi');
    const requestedCwd = path.resolve(projectRoot, 'packages/core');

    expect(resolveModelCallEffectiveCwd({ projectRoot, requestedCwd })).toEqual({
      absolutePath: requestedCwd,
      projectRelativePath: 'packages/core',
    });
  });

  it('rejects cwd outside the project boundary', () => {
    const projectRoot = path.resolve('C:/all/work/study/megumi');

    expect(() => resolveModelCallEffectiveCwd({
      projectRoot,
      requestedCwd: '../outside',
    })).toThrow(/Effective cwd is outside the project/);
  });

  it('returns undefined when there is no project root', () => {
    expect(resolveModelCallEffectiveCwd({})).toBeUndefined();
  });
});

describe('resolveMemoryRecallEffectiveCwd', () => {
  it('defaults to project root and resolves project-relative cwd', () => {
    const projectRoot = path.resolve('C:/all/work/study/megumi');

    expect(resolveMemoryRecallEffectiveCwd({ projectRoot })).toBe(projectRoot);
    expect(resolveMemoryRecallEffectiveCwd({
      projectRoot,
      requestedCwd: 'packages/coding-agent',
    })).toBe(path.join(projectRoot, 'packages/coding-agent'));
  });

  it('keeps absolute cwd and falls back to requested cwd without project root', () => {
    const projectRoot = path.resolve('C:/all/work/study/megumi');
    const requestedCwd = path.join(projectRoot, 'packages/coding-agent');

    expect(resolveMemoryRecallEffectiveCwd({ projectRoot, requestedCwd })).toBe(requestedCwd);
    expect(resolveMemoryRecallEffectiveCwd({ requestedCwd: 'relative/path' })).toBe('relative/path');
  });
});
