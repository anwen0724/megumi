// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Select,
  Tabs,
  TextField
} from '@megumi/desktop/renderer/shared/ui';

describe('shared UI primitives', () => {
  it('opens a listbox and selects an option', async () => {
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
