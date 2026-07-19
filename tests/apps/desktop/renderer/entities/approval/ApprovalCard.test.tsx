// @vitest-environment jsdom
/* Verifies the composer-overlay approval card against canonical Tool Activity facts. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalCard } from '@megumi/desktop/renderer/entities/approval';

const request = {
  itemId: 'tool:write-1',
  kind: 'tool_activity' as const,
  toolCallId: 'write-1',
  toolName: 'write_file',
  displayName: 'Write file',
  inputSummary: '睡前小故事.md',
  status: 'awaiting_approval' as const,
  approval: {
    approvalRequestId: 'approval-1',
    defaultOptionId: 'once:write-1',
    summary: 'write_file requires approval.',
    options: [
      { optionId: 'once:write-1', scope: 'once' as const, label: 'Once', description: 'Only this call.' },
      { optionId: 'session:write-file', scope: 'session' as const, label: 'Session', description: 'Use this tool in the session.' },
    ],
  },
};

describe('ApprovalCard', () => {
  it('restores the original card layout and submits the selected server option once', async () => {
    let finish: ((result: { status: 'failed'; message: string }) => void) | undefined;
    const onResolve = vi.fn(() => new Promise<{ status: 'failed'; message: string }>((resolve) => { finish = resolve; }));
    render(<ApprovalCard request={request} onResolve={onResolve} />);

    expect(screen.getByText('Write file')).toBeInTheDocument();
    expect(screen.getByText('Approval needed')).toBeInTheDocument();
    expect(screen.getByText('睡前小故事.md')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Approval scope'), { target: { value: 'session:write-file' } });
    const approve = screen.getByRole('button', { name: 'Approve Write file' });
    fireEvent.click(approve);
    fireEvent.click(approve);

    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith({ approvalRequestId: 'approval-1', decision: 'approved', optionId: 'session:write-file' });
    expect(screen.getByRole('button', { name: 'Approve Write file' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve Write file' })).toHaveTextContent('Submitting…');
    expect(screen.getByRole('button', { name: 'Deny Write file' })).toBeDisabled();

    finish?.({ status: 'failed', message: 'Settings could not be saved.' });
    await waitFor(() => expect(screen.getByText('Settings could not be saved.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Approve Write file' })).toBeEnabled();
  });
});
