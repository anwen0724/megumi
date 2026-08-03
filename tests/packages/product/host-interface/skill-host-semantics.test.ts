import { describe, expect, it, vi } from 'vitest';
import { createSkillHost } from '../../../../packages/product/src/host/skills-host';
import type { Skills } from '../../../../packages/skills/src';

describe('SkillHost semantics', () => {
  it('projects owner/path and package overview without leaking diagnostics internals', async () => {
    const skillPath = 'C:/workspace/.megumi/skills/review/SKILL.md';
    const list = vi.fn(async () => ({
      status: 'ok' as const,
      skills: [{
        name: 'review',
        description: 'Review code',
        skillPath,
        packagePath: 'C:/workspace/.megumi/skills/review',
        source: { owner: 'user' as const, scope: 'workspace' as const, workspaceId: 'workspace:1' },
        available: true,
        disableModelInvocation: false,
        content: 'Review carefully.',
        diagnostics: [{ level: 'warning' as const, code: 'manifest_name_invalid' as const, message: 'Safe warning.' }],
      }],
      diagnostics: [],
    }));
    const skills = { list } as unknown as Skills;
    const host = createSkillHost({ skills });

    await expect(host.listSkills({ workspaceId: 'workspace:1' })).resolves.toEqual({
      status: 'ok',
      skills: [{
        name: 'review',
        description: 'Review code',
        skillPath,
        sourceLabel: 'User',
        available: true,
        hasResources: false,
        hasScripts: false,
        diagnostics: [{ level: 'warning', message: 'Safe warning.' }],
      }],
    });
    expect(list).toHaveBeenCalledWith({ workspaceId: 'workspace:1' });
  });

  it('addresses Skill detail by skillPath and maps stable failures', async () => {
    const skillPath = 'C:/user/review/SKILL.md';
    const get = vi.fn(async () => ({
      status: 'failed' as const,
      failure: { code: 'skill_not_found' as const, skillPath },
    }));
    const skills = { get } as unknown as Skills;
    const host = createSkillHost({ skills });

    await expect(host.getSkillDetail({ skillPath })).resolves.toEqual({
      status: 'not_found',
      skillPath,
    });
    expect(get).toHaveBeenCalledWith({ skillPath, workspaceId: undefined });
  });

  it('exposes a real refresh operation instead of re-listing', async () => {
    const refresh = vi.fn(async () => ({ status: 'ok' as const, diagnostics: [] }));
    const host = createSkillHost({ skills: { refresh } as unknown as Skills });
    await expect(host.refreshSkills({})).resolves.toEqual({ status: 'ok' });
    expect(refresh).toHaveBeenCalledWith({ workspaceId: undefined });
  });
});
