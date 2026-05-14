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
  Tabs,
  TextField,
} from '@megumi/desktop/renderer/shared/ui';

describe('shared UI primitives', () => {
  it('renders a button with semantic variant classes', () => {
    render(<Button variant="primary">Send</Button>);

    expect(screen.getByRole('button', { name: 'Send' }).className).toContain('bg-[var(--color-accent)]');
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

  it('associates a text field with its label', async () => {
    render(<TextField label="Message" placeholder="Ask Megumi" />);

    await userEvent.type(screen.getByLabelText('Message'), 'Hello');

    expect(screen.getByLabelText('Message')).toHaveValue('Hello');
  });
});
