import { describe, expect, it, vi } from 'vitest';
import { createSkillHost } from '@megumi/product/host-interface/skill-host';

describe('SkillHost semantics', () => {
  it('projects diagnostics into independent host DTOs', async () => {
    const ownerDiagnostic = { level: 'warning' as const, message: 'Safe warning.', internalPath: 'C:/secret' };
    const host = createSkillHost({
      listSkills: vi.fn(async () => ({
        status: 'ok' as const,
        skills: [{
          skillId: 'skill:1',
          name: 'review',
          description: 'Review code',
          source: { label: 'Project' },
          available: true,
          resources: [],
          scripts: [],
          diagnostics: [ownerDiagnostic],
        }],
      })),
    } as never);

    await expect(host.listSkills({})).resolves.toEqual({
      status: 'ok',
      skills: [expect.objectContaining({
        diagnostics: [{ level: 'warning', message: 'Safe warning.' }],
      })],
    });
  });

  it('projects skill failures as structured failures', async () => {
    const host = createSkillHost({
      getSkill: vi.fn(async () => ({
        status: 'failed' as const,
        message: 'Skill failed.',
      })),
    } as never);

    await expect(host.getSkillDetail({ skillId: 'skill:1' })).resolves.toEqual({
      status: 'failed',
      failure: { code: 'skill_failed', message: 'Skill failed.' },
    });
  });
});
