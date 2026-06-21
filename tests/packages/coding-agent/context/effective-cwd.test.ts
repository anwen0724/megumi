// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveModelStepEffectiveCwd } from '@megumi/coding-agent/context';

describe('resolveModelStepEffectiveCwd', () => {
  it('defaults to the project root when no requested cwd is provided', () => {
    const projectRoot = path.resolve('C:/all/work/study/megumi');

    expect(resolveModelStepEffectiveCwd({ projectRoot })).toEqual({
      absolutePath: projectRoot,
      projectRelativePath: '.',
    });
  });

  it('accepts project-relative cwd inside the project boundary', () => {
    const projectRoot = path.resolve('C:/all/work/study/megumi');

    expect(resolveModelStepEffectiveCwd({
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

    expect(resolveModelStepEffectiveCwd({ projectRoot, requestedCwd })).toEqual({
      absolutePath: requestedCwd,
      projectRelativePath: 'packages/core',
    });
  });

  it('rejects cwd outside the project boundary', () => {
    const projectRoot = path.resolve('C:/all/work/study/megumi');

    expect(() => resolveModelStepEffectiveCwd({
      projectRoot,
      requestedCwd: '../outside',
    })).toThrow(/Effective cwd is outside the project/);
  });

  it('returns undefined when there is no project root', () => {
    expect(resolveModelStepEffectiveCwd({})).toBeUndefined();
  });
});
