/* Verifies use_skill keeps full Skill instructions in the runtimeSources side channel. */

import { describe, expect, it, vi } from 'vitest';
import { createBuiltInTestHarness } from './built-in-test-harness';
import { createLocalWorkspaceFileAccess } from './tool-test-fixtures';

describe('use_skill built-in Tool', () => {
  it('acknowledges loading without mixing instructions into visible Tool content', async () => {
    const useSkill = vi.fn(async () => ({
      status: 'ok' as const,
      skill: {
        name: 'review',
        skillPath: 'C:/skills/review/SKILL.md',
        content: 'Review carefully.',
      },
    }));
    const tools = createBuiltInTestHarness({
      workspaceFileAccess: createLocalWorkspaceFileAccess(process.cwd()),
      skills: { useSkill } as never,
    });
    const result = await tools.execute({
      toolName: 'use_skill', input: { skillPath: 'C:/skills/review/SKILL.md' },
    });
    expect(useSkill).toHaveBeenCalledWith({ skillPath: 'C:/skills/review/SKILL.md' });
    expect(result).toMatchObject({
      type: 'succeeded',
      runtimeSources: [{
        sourceId: 'skill:C:/skills/review/SKILL.md',
        sourceKind: 'skill',
        text: 'Review carefully.',
        persisted: false,
        metadata: { name: 'review', originModule: 'skills' },
      }],
    });
    expect(result.normalizedResult.content).not.toContain('Review carefully.');
  });

  it('keeps registration separate from whether a ModelCall has a Run-bound Skills interface', () => {
    const tools = createBuiltInTestHarness({ workspaceFileAccess: createLocalWorkspaceFileAccess(process.cwd()) });
    expect(tools.get('use_skill').status).toBe('found');
  });

  it('returns a normal Tool failure for a Skill outside the Run snapshot', async () => {
    const tools = createBuiltInTestHarness({
      workspaceFileAccess: createLocalWorkspaceFileAccess(process.cwd()),
      skills: {
        useSkill: vi.fn(async () => ({ status: 'not_found' as const, skillPath: 'C:/other/SKILL.md' })),
      } as never,
    });
    await expect(tools.execute({
      toolName: 'use_skill', input: { skillPath: 'C:/other/SKILL.md' },
    })).resolves.toMatchObject({ type: 'failed', toolName: 'use_skill' });
  });
});
