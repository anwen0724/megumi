// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApprovalCard } from '@megumi/desktop/renderer/entities/approval';

const request = {
  toolCallId: 'approval-1',
  toolName: 'run_command',
  arguments: { command: 'npm test' },
  displayText: 'Run npm test',
};

describe('ApprovalCard', () => {
  it('renders the approval request details', () => {
    render(<ApprovalCard request={request} onApprove={() => undefined} onDeny={() => undefined} />);

    expect(screen.getByText('Approval needed')).toBeInTheDocument();
    expect(screen.getByText('run_command')).toBeInTheDocument();
    expect(screen.getByText('Run npm test')).toBeInTheDocument();
    expect(screen.getByText('npm test')).toBeInTheDocument();
  });

  it('calls approve and deny handlers', async () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();

    render(<ApprovalCard request={request} onApprove={onApprove} onDeny={onDeny} />);

    await userEvent.click(screen.getByRole('button', { name: 'Approve run_command' }));
    await userEvent.click(screen.getByRole('button', { name: 'Deny run_command' }));

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it('calls view details handler when provided', async () => {
    const onViewDetails = vi.fn();

    render(
      <ApprovalCard
        request={request}
        onApprove={() => undefined}
        onDeny={() => undefined}
        onViewDetails={onViewDetails}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'View run_command details' }));

    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });
});
