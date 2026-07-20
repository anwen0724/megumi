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

    expect(await screen.findAllByRole('button', { name: 'More actions for Review' })).toHaveLength(2);
    expect(screen.getByText('Review homework')).toBeInTheDocument();
    expect(screen.getByText('Review source text')).toBeInTheDocument();
    expect(screen.getAllByText('System').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('User').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ payload: { workspaceId: 'workspace:1' } }));
  });

  it('filters the visible list without changing discovered Skills', async () => {
    const user = userEvent.setup();
    installSkillApi({
      list: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          status: 'ok',
          skills: [
            skill('review', 'C:/home/.megumi/skills/review/SKILL.md', 'User', 'Review homework'),
            skill('explain', 'C:/app/skills/.system/explain/SKILL.md', 'System', 'Explain a problem'),
          ],
        },
      }),
    });

    render(<SkillSettingsPanel />);
    await screen.findByText('Review homework');

    await user.click(screen.getByRole('tab', { name: 'System' }));
    expect(screen.queryByText('Review homework')).not.toBeInTheDocument();
    expect(screen.getByText('Explain a problem')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'All' }));
    expect(screen.getByText('Review homework')).toBeInTheDocument();
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
    const availability = await screen.findByRole('switch', { name: 'Disable Review' });
    expect(availability).toHaveAttribute('aria-checked', 'true');
    await user.click(availability);

    await waitFor(() => expect(disable).toHaveBeenCalledWith(expect.objectContaining({
      payload: { workspaceId: 'workspace:1', skillPath },
    })));
  });

  it('opens Skill details from the actions menu and closes the dialog with Escape', async () => {
    const user = userEvent.setup();
    const skillPath = 'C:/home/.megumi/skills/review/SKILL.md';
    const get = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        status: 'ok',
        skill: {
          ...skill('review', skillPath, 'User', 'Review homework'),
          content: 'Review the answer carefully.',
          resourcePaths: ['references/rubric.md'],
          scriptNames: [],
        },
      },
    });
    installSkillApi({
      list: vi.fn().mockResolvedValue({
        ok: true,
        data: { status: 'ok', skills: [skill('review', skillPath, 'User', 'Review homework')] },
      }),
      get,
    });

    render(<SkillSettingsPanel />);
    await user.click(await screen.findByRole('button', { name: 'More actions for Review' }));
    await user.click(screen.getByRole('menuitem', { name: 'Details' }));

    expect(await screen.findByRole('dialog', { name: 'Review details' })).toBeInTheDocument();
    expect(screen.getByText(skillPath)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close details' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

function skill(name: string, skillPath: string, sourceLabel: 'System' | 'User', description: string) {
  return {
    name, description, skillPath, sourceLabel, available: true,
    hasResources: false, hasScripts: false, diagnostics: [],
  };
}

function installSkillApi(overrides: {
  list: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
  disable?: ReturnType<typeof vi.fn>;
}) {
  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      skill: {
        list: overrides.list,
        get: overrides.get ?? vi.fn(),
        enable: vi.fn(),
        disable: overrides.disable ?? vi.fn(),
      },
    },
  });
}
