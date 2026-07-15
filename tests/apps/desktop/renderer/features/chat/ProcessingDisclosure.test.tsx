// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ProcessingDisclosure } from '@megumi/desktop/renderer/features/chat/components/ProcessingDisclosure';
import type { ProcessingDisclosureModel } from '@megumi/desktop/renderer/features/chat/processing-disclosure';

function model(overrides: Partial<ProcessingDisclosureModel> = {}): ProcessingDisclosureModel {
  return {
    runId: 'run-1',
    status: 'running',
    durationSeconds: 42,
    live: true,
    startedAt: '2026-05-18T12:00:00.000Z',
    currentAction: { key: 'processing.projection.preparingReply' },
    completedEntries: [
      {
        id: 'entry-1',
        label: { key: 'processing.projection.contextUpdated' },
        detail: { key: 'processing.projection.sources', values: { count: 3 } },
        createdAt: '2026-05-18T12:00:02.000Z',
        tone: 'success',
      },
    ],
    ...overrides,
  };
}

describe('ProcessingDisclosure', () => {
  it('renders running disclosure expanded by default with current action and completed entries', () => {
    render(<ProcessingDisclosure model={model()} />);

    expect(screen.getByRole('button', { name: /Collapse process disclosure/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(screen.getByText('42s')).toBeInTheDocument();
    expect(screen.queryByText('live')).not.toBeInTheDocument();
    expect(screen.getByText('Current action')).toBeInTheDocument();
    expect(screen.getByText('Preparing the final response…')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Effective context updated')).toBeInTheDocument();
    expect(screen.queryByText(/下一步|思考过程|chain-of-thought/i)).not.toBeInTheDocument();
  });

  it('renders completed disclosure collapsed by default and expands on click', async () => {
    render(
      <ProcessingDisclosure
        model={model({
          status: 'completed',
          durationSeconds: 102,
          live: false,
          currentAction: undefined,
          endedAt: '2026-05-18T12:01:42.000Z',
        })}
      />,
    );

    const toggle = screen.getByRole('button', { name: /Expand process disclosure/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Effective context updated')).not.toBeInTheDocument();

    await userEvent.click(toggle);

    expect(screen.getByRole('button', { name: /Collapse process disclosure/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('Effective context updated')).toBeInTheDocument();
  });

  it('renders empty completed work record without claiming future work', () => {
    render(
      <ProcessingDisclosure
        model={model({
          completedEntries: [],
          currentAction: undefined,
          status: 'completed',
          live: false,
        })}
      />,
    );

    expect(screen.getByRole('button', { name: /Expand process disclosure/ })).toBeInTheDocument();
    expect(screen.queryByText('下一步')).not.toBeInTheDocument();
  });
});
