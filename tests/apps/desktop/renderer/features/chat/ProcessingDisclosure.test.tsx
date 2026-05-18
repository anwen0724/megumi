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
    statusLabel: '正在处理',
    durationLabel: '42s',
    live: true,
    startedAt: '2026-05-18T12:00:00.000Z',
    currentAction: '正在生成回复...',
    completedEntries: [
      {
        id: 'entry-1',
        label: '已更新有效上下文',
        detail: '3 个来源',
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

    expect(screen.getByRole('button', { name: /Collapse processing disclosure/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('正在处理')).toBeInTheDocument();
    expect(screen.getByText('42s')).toBeInTheDocument();
    expect(screen.getByText('live')).toBeInTheDocument();
    expect(screen.getByText('当前动作')).toBeInTheDocument();
    expect(screen.getByText('正在生成回复...')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('已更新有效上下文')).toBeInTheDocument();
    expect(screen.queryByText(/下一步|思考过程|chain-of-thought/i)).not.toBeInTheDocument();
  });

  it('renders completed disclosure collapsed by default and expands on click', async () => {
    render(
      <ProcessingDisclosure
        model={model({
          status: 'completed',
          statusLabel: '已处理',
          durationLabel: '1m 42s',
          live: false,
          currentAction: undefined,
          endedAt: '2026-05-18T12:01:42.000Z',
        })}
      />,
    );

    const toggle = screen.getByRole('button', { name: /Expand processing disclosure/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('已更新有效上下文')).not.toBeInTheDocument();

    await userEvent.click(toggle);

    expect(screen.getByRole('button', { name: /Collapse processing disclosure/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('已更新有效上下文')).toBeInTheDocument();
  });

  it('renders empty completed work record without claiming future work', () => {
    render(
      <ProcessingDisclosure
        model={model({
          completedEntries: [],
          currentAction: undefined,
          status: 'completed',
          statusLabel: '已处理',
          live: false,
        })}
      />,
    );

    expect(screen.getByRole('button', { name: /Expand processing disclosure/ })).toBeInTheDocument();
    expect(screen.queryByText('下一步')).not.toBeInTheDocument();
  });
});
