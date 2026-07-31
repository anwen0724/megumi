/* Verifies use_skill keeps full Skill instructions in the runtimeSources side channel. */

import { describe, expect, it, vi } from 'vitest';
import { createTools } from '../../../packages/tools/src';
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
    const tools = createTools({
      workspaceFileAccess: createLocalWorkspaceFileAccess(process.cwd()),
      skills: { useSkill } as never,
    });
    const result = await tools.executor.execute({
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

  it('does not register use_skill without a Run-bound Skills interface', () => {
    const tools = createTools({ workspaceFileAccess: createLocalWorkspaceFileAccess(process.cwd()) });
    expect(tools.catalog.get({ toolName: 'use_skill' }).status).toBe('not_found');
  });

  it('returns a normal Tool failure for a Skill outside the Run snapshot', async () => {
    const tools = createTools({
      workspaceFileAccess: createLocalWorkspaceFileAccess(process.cwd()),
      skills: {
        useSkill: vi.fn(async () => ({ status: 'not_found' as const, skillPath: 'C:/other/SKILL.md' })),
      } as never,
    });
    await expect(tools.executor.execute({
      toolName: 'use_skill', input: { skillPath: 'C:/other/SKILL.md' },
    })).resolves.toMatchObject({ type: 'failed', toolName: 'use_skill' });
  });
});
