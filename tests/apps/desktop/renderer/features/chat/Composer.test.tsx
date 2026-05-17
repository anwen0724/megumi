// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from '@megumi/desktop/renderer/features/chat/components/Composer';

describe('Composer', () => {
  it('renders mode, model, context, attachment, and disabled send controls', () => {
    render(<Composer onSubmit={() => undefined} />);

    expect(screen.getByLabelText('Composer mode')).toHaveValue('chat');
    expect(screen.getByLabelText('Model')).toHaveValue('deepseek-v4-flash');
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose context' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('submits trimmed text with selected mode and model then clears the input', async () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);

    await userEvent.selectOptions(screen.getByLabelText('Composer mode'), 'execute');
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'deepseek-v4-pro');
    await userEvent.type(screen.getByLabelText('Message Megumi'), '  hello Megumi  ');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenCalledWith({
      message: 'hello Megumi',
      mode: 'execute',
      model: 'deepseek-v4-pro',
    });
    expect(screen.getByLabelText('Message Megumi')).toHaveValue('');
  });

  it('calls context and attachment callbacks', async () => {
    const onChooseContext = vi.fn();
    const onAttachFiles = vi.fn();

    render(
      <Composer
        onSubmit={() => undefined}
        onChooseContext={onChooseContext}
        onAttachFiles={onAttachFiles}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Choose context' }));
    await userEvent.click(screen.getByRole('button', { name: 'Attach files' }));

    expect(onChooseContext).toHaveBeenCalledTimes(1);
    expect(onAttachFiles).toHaveBeenCalledTimes(1);
  });

  it('shows sending status, allows drafting the next message, and locks submit', async () => {
    render(<Composer status="sending" onSubmit={() => undefined} initialValue="Continue this plan" />);

    expect(screen.getByText('Sending')).toBeInTheDocument();
    expect(screen.getByLabelText('Message Megumi')).toHaveValue('Continue this plan');

    await userEvent.type(screen.getByLabelText('Message Megumi'), ' after this run');

    expect(screen.getByLabelText('Message Megumi')).toHaveValue('Continue this plan after this run');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('shows running status, allows model changes for the next message, and disables send', async () => {
    render(<Composer status="running" onSubmit={() => undefined} />);

    await userEvent.type(screen.getByLabelText('Message Megumi'), 'continue');
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'deepseek-v4-pro');

    expect(screen.getByText('Megumi is working')).toBeInTheDocument();
    expect(screen.getByLabelText('Message Megumi')).toHaveValue('continue');
    expect(screen.getByLabelText('Model')).toHaveValue('deepseek-v4-pro');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('shows waiting approval status and calls the approval callback', async () => {
    const onShowApproval = vi.fn();

    render(<Composer status="waiting-approval" onSubmit={() => undefined} onShowApproval={onShowApproval} />);

    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Review approval' }));

    expect(onShowApproval).toHaveBeenCalledTimes(1);
  });

  it('shows error status without rendering error details inside the composer', () => {
    render(
      <Composer
        status="error"
        onSubmit={() => undefined}
      />,
    );

    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.queryByText('The last response failed.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry last message' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('does not submit or retry when switching models after an empty error draft', async () => {
    const onSubmit = vi.fn();

    render(
      <Composer
        status="error"
        onSubmit={onSubmit}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText('Model'), 'deepseek-v4-flash');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits a new draft after an error with the selected model', async () => {
    const onSubmit = vi.fn();

    render(
      <Composer
        status="error"
        onSubmit={onSubmit}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText('Model'), 'deepseek-v4-flash');
    await userEvent.type(screen.getByLabelText('Message Megumi'), 'try again normally');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenCalledWith({
      message: 'try again normally',
      mode: 'chat',
      model: 'deepseek-v4-flash',
    });
  });
});
