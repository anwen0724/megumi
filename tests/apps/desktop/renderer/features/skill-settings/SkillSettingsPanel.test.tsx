// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillSettingsPanel } from '@megumi/desktop/renderer/features/skill-settings';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';

describe('SkillSettingsPanel', () => {
  beforeEach(() => {
    useProjectStore.setState({ currentProjectId: 'workspace:1' });
  });

  it('keeps same-name Skills distinct by path and shows only System/User sources', async () => {
    const list = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        status: 'ok',
        skills: [
          skill('review', 'C:/home/.megumi/skills/review/SKILL.md', 'User', 'Review homework'),
          skill('review', 'C:/app/skills/.system/review/SKILL.md', 'System', 'Review source text'),
        ],
      },
    });
    installSkillApi({ list });

    render(<SkillSettingsPanel />);

    expect(await screen.findAllByRole('button', { name: 'View Review details' })).toHaveLength(2);
    expect(screen.getByText('Review homework')).toBeInTheDocument();
    expect(screen.getByText('Review source text')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ payload: { workspaceId: 'workspace:1' } }));
  });

  it('mutates availability by the exact skillPath', async () => {
    const user = userEvent.setup();
    const skillPath = 'C:/home/.megumi/skills/review/SKILL.md';
    const disable = vi.fn().mockResolvedValue({ ok: true, data: { status: 'ok', skillPath } });
    installSkillApi({
      list: vi.fn().mockResolvedValue({
        ok: true,
        data: { status: 'ok', skills: [skill('review', skillPath, 'User', 'Review homework')] },
      }),
      disable,
    });

    render(<SkillSettingsPanel />);
    await user.click(await screen.findByRole('button', { name: 'Disable Review' }));

    await waitFor(() => expect(disable).toHaveBeenCalledWith(expect.objectContaining({
      payload: { workspaceId: 'workspace:1', skillPath },
    })));
  });
});

function skill(name: string, skillPath: string, sourceLabel: 'System' | 'User', description: string) {
  return {
    name, description, skillPath, sourceLabel, available: true,
    hasResources: false, hasScripts: false, diagnostics: [],
  };
}

function installSkillApi(overrides: { list: ReturnType<typeof vi.fn>; disable?: ReturnType<typeof vi.fn> }) {
  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      skill: {
        list: overrides.list,
        get: vi.fn(),
        enable: vi.fn(),
        disable: overrides.disable ?? vi.fn(),
      },
    },
  });
}
