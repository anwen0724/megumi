// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BranchDraftStack } from '@megumi/desktop/renderer/features/chat/components/BranchDraftStack';

describe('BranchDraftStack', () => {
  it('renders branch draft chrome and cancels from the stack', async () => {
    const onCancel = vi.fn();
    render(
      <BranchDraftStack
        branchDraft={{
          key: 'branch-marker-1',
          label: 'Branch from 07:28',
          seedText: 'original prompt',
          onCancel,
        }}
      />,
    );

    expect(screen.getByTestId('branch-draft-stack')).toHaveTextContent('Branch from 07:28');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel branch' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when there is no branch draft', () => {
    const { container } = render(<BranchDraftStack branchDraft={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
