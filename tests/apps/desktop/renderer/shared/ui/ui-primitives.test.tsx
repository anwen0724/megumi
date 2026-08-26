// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Badge,
  Button,
  IconButton,
  Panel,
  PanelHeader,
  PanelTitle,
  SettingsSection,
  Select,
  Tabs,
  TextField,
} from '@megumi/desktop/renderer/shared/ui';

describe('shared UI primitives', () => {
  it('renders a button with semantic variant classes', () => {
    render(<Button variant="primary">Send</Button>);

    expect(screen.getByRole('button', { name: 'Send' }).className).toContain('bg-[var(--color-accent)]');
    expect(screen.getByRole('button', { name: 'Send' }).className).toContain('active:scale-[0.98]');
  });

  it('opens a styled listbox and selects an option', async () => {
    const onValueChange = vi.fn();
    render(
      <Select
        label="Execution result"
        value="all"
        options={[
          { value: 'all', label: 'All results' },
          { value: 'error', label: 'Failed' },
        ]}
        onValueChange={onValueChange}
      />,
    );

    await userEvent.click(screen.getByRole('combobox', { name: 'Execution result' }));
    expect(screen.getByRole('listbox', { name: 'Execution result' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'Failed' }));

    expect(onValueChange).toHaveBeenCalledWith('error');
  });

  it('renders a settings section header action on the title row', () => {
    render(
      <SettingsSection title="Voice replies" headerAction={<button type="button">Toggle</button>}>
        <p>Body</p>
      </SettingsSection>,
    );

    expect(screen.getByRole('heading', { name: 'Voice replies' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle' })).toBeInTheDocument();
  });

  it('renders an icon button with an accessible label', () => {
    render(<IconButton label="Toggle theme">T</IconButton>);

    expect(screen.getByRole('button', { name: 'Toggle theme' })).toBeInTheDocument();
  });

  it('renders a badge with status text', () => {
    render(<Badge variant="success">Ready</Badge>);

    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('renders a titled panel', () => {
    render(
      <Panel>
        <PanelHeader>
          <PanelTitle>Tasks</PanelTitle>
        </PanelHeader>
      </Panel>,
    );

    expect(screen.getByText('Tasks')).toBeInTheDocument();
  });

  it('switches tabs through the controlled callback', async () => {
    const onValueChange = vi.fn();

    render(
      <Tabs
        ariaLabel="Workspace tabs"
        value="context"
        onValueChange={onValueChange}
        tabs={[
          { id: 'context', label: 'Context' },
          { id: 'tasks', label: 'Tasks' },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Tasks' }));

    expect(onValueChange).toHaveBeenCalledWith('tasks');
  });

  it('supports keyboard navigation between enabled tabs', async () => {
    const onValueChange = vi.fn();

    render(
      <Tabs
        ariaLabel="Workspace tabs"
        value="files"
        onValueChange={onValueChange}
        tabs={[
          { id: 'files', label: 'Files' },
          { id: 'context', label: 'Context' },
          { id: 'artifacts', label: 'Artifacts', disabled: true },
          { id: 'memory', label: 'Memory' },
        ]}
      />,
    );

    const filesTab = screen.getByRole('tab', { name: 'Files' });
    const contextTab = screen.getByRole('tab', { name: 'Context' });
    const memoryTab = screen.getByRole('tab', { name: 'Memory' });

    filesTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onValueChange).toHaveBeenLastCalledWith('context');
    expect(contextTab).toHaveFocus();

    await userEvent.keyboard('{End}');
    expect(onValueChange).toHaveBeenLastCalledWith('memory');
    expect(memoryTab).toHaveFocus();

    await userEvent.keyboard('{Home}');
    expect(onValueChange).toHaveBeenLastCalledWith('files');
    expect(filesTab).toHaveFocus();
  });

  it('associates a text field with its label', async () => {
    render(<TextField label="Message" placeholder="Ask Megumi" />);

    await userEvent.type(screen.getByLabelText('Message'), 'Hello');

    expect(screen.getByLabelText('Message')).toHaveValue('Hello');
  });
});
