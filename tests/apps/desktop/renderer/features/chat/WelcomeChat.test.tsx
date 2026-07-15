// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { WelcomeChat } from '@megumi/desktop/renderer/features/chat/components/WelcomeChat';
import { initializeRendererI18n } from '@megumi/desktop/renderer/shared/i18n';

const megumiProject = {
  id: 'project-1',
  name: 'Megumi',
  repoPath: 'C:/workspaces/megumi',
};

const otherProject = {
  id: 'project-2',
  name: 'Other',
  repoPath: 'C:/workspaces/other',
};

function renderWelcomeChat(overrides: Partial<Parameters<typeof WelcomeChat>[0]> = {}) {
  const props: Parameters<typeof WelcomeChat>[0] = {
    currentProject: megumiProject,
    currentProjectId: megumiProject.id,
    projects: [megumiProject, otherProject],
    canChangeNewSessionProject: true,
    projectPickerOpen: false,
    onOpenWorkspace: vi.fn(),
    onToggleProjectPicker: vi.fn(),
    onCloseProjectPicker: vi.fn(),
    onSwitchProject: vi.fn(),
    ...overrides,
  };

  render(<WelcomeChat {...props} />);

  return props;
}

describe('WelcomeChat', () => {
  it('renders the chat entry surface in Simplified Chinese', async () => {
    await initializeRendererI18n('zh-CN');
    renderWelcomeChat({ projectPickerOpen: true });

    expect(screen.getByText('欢迎使用 Megumi')).toBeInTheDocument();
    expect(screen.getByText('新会话位于')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索项目')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '添加项目' })).toBeInTheDocument();
  });

  it('keeps the intro text static and exposes a lightweight highlighted project selector button', () => {
    renderWelcomeChat();

    expect(screen.getByText('New session in')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New session in/ })).not.toBeInTheDocument();

    const projectButton = screen.getByRole('button', { name: 'Select project: Megumi' });
    expect(projectButton).toHaveClass('text-[var(--color-accent)]');
    expect(projectButton).toHaveClass('hover:bg-[var(--color-surface-hover)]');
    expect(projectButton).not.toHaveClass('border');
    expect(projectButton).not.toHaveClass('bg-[var(--color-surface-raised)]');
  });

  it('renders an opaque project menu with English search, visible hover states, and add project action', () => {
    renderWelcomeChat({ projectPickerOpen: true });

    const menu = screen.getByRole('menu', { name: 'Choose project for new session' });
    expect(menu).toHaveClass('left-0');
    expect(menu).not.toHaveClass('left-1/2');
    expect(menu).not.toHaveClass('-translate-x-1/2');
    expect(menu).toHaveClass('bg-[var(--color-surface-elevated)]');
    const searchInput = within(menu).getByPlaceholderText('Search projects');
    expect(searchInput).toBeInTheDocument();
    expect(searchInput.closest('label')).not.toHaveClass('border-b');
    expect(within(menu).queryByPlaceholderText('搜索项目')).not.toBeInTheDocument();

    const projectItem = within(menu).getByRole('menuitem', { name: /Megumi/ });
    expect(projectItem).toHaveClass('hover:bg-[var(--color-accent-soft)]');
    expect(within(menu).getByLabelText('Current project')).toBeInTheDocument();

    const addProjectItem = within(menu).getByRole('menuitem', { name: 'Add project' });
    expect(addProjectItem).toHaveClass('hover:bg-[var(--color-accent-soft)]');
    expect(addProjectItem.parentElement).toHaveClass('border-t');
    expect(addProjectItem.parentElement).toHaveClass(
      'border-[color-mix(in_srgb,var(--color-border-subtle)_45%,transparent)]',
    );
    expect(within(menu).queryByRole('menuitem', { name: '添加新项目' })).not.toBeInTheDocument();
  });

  it('opens the project menu when the enabled selector button is clicked', () => {
    function StatefulWelcomeChat() {
      const [projectPickerOpen, setProjectPickerOpen] = useState(false);

      return (
        <WelcomeChat
          currentProject={megumiProject}
          currentProjectId={megumiProject.id}
          projects={[megumiProject, otherProject]}
          canChangeNewSessionProject
          projectPickerOpen={projectPickerOpen}
          onOpenWorkspace={vi.fn()}
          onToggleProjectPicker={() => setProjectPickerOpen((value) => !value)}
          onCloseProjectPicker={() => setProjectPickerOpen(false)}
          onSwitchProject={vi.fn()}
        />
      );
    }

    render(<StatefulWelcomeChat />);

    const projectButton = screen.getByRole('button', { name: 'Select project: Megumi' });
    expect(projectButton).toBeEnabled();

    fireEvent.click(projectButton);

    expect(screen.getByRole('menu', { name: 'Choose project for new session' })).toBeInTheDocument();
  });

  it('closes the project menu on outside click and Escape', () => {
    const props = renderWelcomeChat({ projectPickerOpen: true });

    fireEvent.pointerDown(document.body);
    expect(props.onCloseProjectPicker).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onCloseProjectPicker).toHaveBeenCalledTimes(2);
  });

  it('closes the menu after switching project or opening the project picker dialog', () => {
    const switchProps = renderWelcomeChat({ projectPickerOpen: true });

    fireEvent.click(screen.getByRole('menuitem', { name: /Other/ }));

    expect(switchProps.onSwitchProject).toHaveBeenCalledWith(otherProject.id);
    expect(switchProps.onCloseProjectPicker).toHaveBeenCalledTimes(1);

    const addProps = renderWelcomeChat({ projectPickerOpen: true });

    fireEvent.click(screen.getAllByRole('menuitem', { name: 'Add project' }).at(-1)!);

    expect(addProps.onOpenWorkspace).toHaveBeenCalledTimes(1);
    expect(addProps.onCloseProjectPicker).toHaveBeenCalledTimes(1);
  });
});
