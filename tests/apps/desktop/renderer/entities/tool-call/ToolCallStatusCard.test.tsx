// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolCallStatusCard } from '@megumi/desktop/renderer/entities/tool-call';

describe('ToolCallStatusCard', () => {
  it('renders an executing tool call', () => {
    render(
      <ToolCallStatusCard
        toolCall={{
          id: 'tool-1',
          name: 'read_file',
          args: { path: 'apps/desktop/src/renderer/app/App.tsx' },
          status: 'executing',
        }}
      />,
    );

    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('apps/desktop/src/renderer/app/App.tsx')).toBeInTheDocument();
  });

  it('renders a completed tool call with duration and output', () => {
    render(
      <ToolCallStatusCard
        toolCall={{
          id: 'tool-2',
          name: 'search_content',
          args: { query: 'ThemeProvider' },
          status: 'completed',
          result: 'Found 3 matches',
          duration: '120ms',
        }}
      />,
    );

    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('120ms')).toBeInTheDocument();
    expect(screen.getByText('Found 3 matches')).toBeInTheDocument();
  });

  it('renders a failed tool call with the error message', () => {
    render(
      <ToolCallStatusCard
        toolCall={{
          id: 'tool-3',
          name: 'run_command',
          args: { command: 'npm test' },
          status: 'failed',
          error: 'Command failed',
        }}
      />,
    );

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Command failed')).toBeInTheDocument();
  });
});
