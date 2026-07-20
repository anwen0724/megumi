import { describe, expect, it, vi } from 'vitest';
import { createSkillHost } from '@megumi/product/host-interface/skill-host';

describe('SkillHost semantics', () => {
  it('resolves a root-bound service and projects owner/path without leaking diagnostics internals', async () => {
    const skillPath = 'C:/workspace/.megumi/skills/review/SKILL.md';
    const listSkills = vi.fn(async () => ({
      status: 'ok' as const,
      skills: [{
        name: 'review',
        description: 'Review code',
        skillPath,
        source: { owner: 'user' as const, rootPath: 'C:/workspace/.megumi/skills' },
        available: true,
        content: 'Review carefully.',
        resources: [],
        scripts: [],
        diagnostics: [{ level: 'warning' as const, message: 'Safe warning.', internalPath: 'C:/secret' }],
      }],
    }));
    const resolveSkillService = vi.fn(() => ({ listSkills }));
    const host = createSkillHost({ resolveSkillService } as never);

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
    expect(resolveSkillService).toHaveBeenCalledWith({ workspaceId: 'workspace:1' });
    expect(listSkills).toHaveBeenCalledWith({});
  });

  it('addresses Skill detail by skillPath', async () => {
    const skillPath = 'C:/user/review/SKILL.md';
    const getSkill = vi.fn(async () => ({ status: 'failed' as const, message: 'Skill failed.' }));
    const host = createSkillHost({ resolveSkillService: () => ({ getSkill }) } as never);

    await expect(host.getSkillDetail({ skillPath })).resolves.toEqual({
      status: 'failed',
      failure: { code: 'skill_failed', message: 'Skill failed.' },
    });
    expect(getSkill).toHaveBeenCalledWith({ skillPath });
  });
});
