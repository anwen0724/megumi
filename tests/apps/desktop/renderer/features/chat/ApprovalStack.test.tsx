/*
 * Verifies approval card render failures stay local to the approval stack.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalStack } from '@megumi/desktop/renderer/features/chat/components/ApprovalStack';
import { ToastViewport, useToastStore } from '@megumi/desktop/renderer/shared/ui';

describe('ApprovalStack', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useToastStore.getState().clearToasts();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useToastStore.getState().clearToasts();
  });

  it('does not crash the page when one persisted approval request is malformed', () => {
    render(
      <>
        <ToastViewport />
        <ApprovalStack
          requests={[{
            approvalRequestId: 'approval-bad',
            runId: 'run-1',
            title: 'write_file',
            status: 'pending',
            requestedScope: 'once',
            summary: 'write_file requires approval.',
            preview: undefined,
            createdAt: '2026-07-09T00:00:00.000Z',
          } as never]}
          onResolve={vi.fn()}
        />
        <div>Composer remains usable</div>
      </>,
    );

    expect(screen.getByText('Composer remains usable')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Approval could not be displayed');
  });
});
