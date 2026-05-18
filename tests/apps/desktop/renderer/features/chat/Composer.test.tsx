// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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

  it('submits trimmed text with selected mode and model then clears the input from the Send button', async () => {
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

  it('submits with Enter and clears the input', async () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText('Message Megumi'), 'Send from keyboard');
    await userEvent.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledWith({
      message: 'Send from keyboard',
      mode: 'chat',
      model: 'deepseek-v4-flash',
    });
    expect(screen.getByLabelText('Message Megumi')).toHaveValue('');
  });

  it('keeps Shift+Enter and Alt+Enter as newline shortcuts without submitting', async () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);
    const input = screen.getByLabelText('Message Megumi');

    await userEvent.click(input);
    await userEvent.keyboard('first line{Shift>}{Enter}{/Shift}second line{Alt>}{Enter}{/Alt}third line');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveValue('first line\nsecond line\nthird line');
  });

  it('does not submit while an IME composition is confirming text', () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);
    const input = screen.getByLabelText('Message Megumi');

    fireEvent.change(input, { target: { value: 'nihao' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveValue('nihao');
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

  it('renders a compact toolbar with context on the left and mode, model, and Send on the right', () => {
    render(<Composer onSubmit={() => undefined} />);

    const toolbar = screen.getByTestId('composer-toolbar');
    const leftControls = toolbar.firstElementChild;
    const rightControls = toolbar.lastElementChild;

    expect(screen.getByRole('button', { name: 'Choose context' })).toHaveTextContent('Context');
    expect(screen.getByTestId('composer-input-panel')).toHaveClass('border-b');
    expect(toolbar).toHaveClass('justify-between');
    expect(leftControls).toHaveTextContent('Context');
    expect(rightControls?.children).toHaveLength(3);
    expect(rightControls?.children[0]).toContainElement(screen.getByLabelText('Composer mode'));
    expect(rightControls?.children[1]).toContainElement(screen.getByLabelText('Model'));
    expect(rightControls?.children[2]).toBe(screen.getByRole('button', { name: 'Send message' }));
  });

  it('shows sending status, allows drafting the next message, and shows Stop instead of Send', async () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    render(<Composer status="sending" onSubmit={onSubmit} onStop={onStop} initialValue="Continue this plan" />);

    expect(screen.getByText('Sending')).toBeInTheDocument();
    expect(screen.getByLabelText('Message Megumi')).toHaveValue('Continue this plan');

    await userEvent.type(screen.getByLabelText('Message Megumi'), ' after this run');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Stop current run' }));

    expect(screen.getByLabelText('Message Megumi')).toHaveValue('Continue this plan after this run');
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('shows running status, keeps the compact draft placeholder, and uses Stop for the active run', async () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    render(<Composer status="running" onSubmit={onSubmit} onStop={onStop} />);

    expect(screen.getByPlaceholderText('Draft a follow-up while Megumi works...')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Message Megumi'), 'continue');
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'deepseek-v4-pro');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Stop current run' }));

    const toolbar = screen.getByTestId('composer-toolbar');
    const rightControls = toolbar.lastElementChild;

    expect(screen.getByText('Megumi is working')).toBeInTheDocument();
    expect(screen.getByLabelText('Message Megumi')).toHaveValue('continue');
    expect(screen.getByLabelText('Model')).toHaveValue('deepseek-v4-pro');
    expect(rightControls).toHaveTextContent('Chat');
    expect(rightControls).toHaveTextContent('DeepSeek V4 Pro');
    expect(rightControls?.lastElementChild).toBe(screen.getByRole('button', { name: 'Stop current run' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('does not render an enabled Stop button without a stop handler', () => {
    render(<Composer status="running" onSubmit={() => undefined} />);

    expect(screen.getByRole('button', { name: 'Stop current run' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
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
