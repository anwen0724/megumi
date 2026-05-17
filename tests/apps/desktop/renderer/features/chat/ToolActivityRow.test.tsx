// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CompletedToolActivity } from '@megumi/desktop/renderer/entities/chat/store';
import { ToolActivityRow } from '@megumi/desktop/renderer/features/chat/components/ToolActivityRow';

const activity: CompletedToolActivity = {
  id: 'activity-1',
  name: 'read_workspace',
  args: {
    query: 'Inspect the workspace',
    mode: 'execute',
    model: 'deepseek-v4-pro',
  },
  result: 'Prepared workspace context for "Inspect the workspace".',
  duration: '240ms',
  completedAt: '2026-05-10T12:00:00.350Z',
};

describe('ToolActivityRow', () => {
  it('renders a quiet collapsed activity button', () => {
    render(<ToolActivityRow activity={activity} expanded={false} onToggle={() => undefined} />);

    expect(screen.getByRole('button', { name: 'Expand completed tool activity read_workspace' })).toBeInTheDocument();
    expect(screen.getByText('Megumi checked workspace context')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('240ms')).toBeInTheDocument();
    expect(screen.queryByText('Prepared workspace context for "Inspect the workspace".')).not.toBeInTheDocument();
  });

  it('calls onToggle when the collapsed row is clicked', () => {
    const onToggle = vi.fn();
    render(<ToolActivityRow activity={activity} expanded={false} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand completed tool activity read_workspace' }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders the existing tool card when expanded', () => {
    render(<ToolActivityRow activity={activity} expanded onToggle={() => undefined} />);

    expect(screen.getByRole('button', { name: 'Collapse completed tool activity read_workspace' })).toBeInTheDocument();
    expect(screen.getByText('read_workspace')).toBeInTheDocument();
    expect(screen.getByText('Inspect the workspace')).toBeInTheDocument();
    expect(screen.getByText('Prepared workspace context for "Inspect the workspace".')).toBeInTheDocument();
  });
});
