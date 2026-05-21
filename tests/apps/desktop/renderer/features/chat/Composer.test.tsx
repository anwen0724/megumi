// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '@megumi/desktop/renderer/features/chat/components/Composer';

function setTextareaScrollHeight(textarea: HTMLElement, scrollHeight: number) {
  Object.defineProperty(textarea, 'scrollHeight', {
    configurable: true,
    value: scrollHeight,
  });
}

describe('Composer', () => {
  it('renders permission mode, model, context, attachment, and disabled send controls', () => {
    render(<Composer onSubmit={() => undefined} />);

    expect(screen.getByLabelText('Permission mode')).toHaveValue('default');
    expect(screen.getByLabelText('Model')).toHaveValue('deepseek-v4-flash');
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose context' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('submits trimmed text with selected permission mode and model then clears the input', async () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);

    await userEvent.selectOptions(screen.getByLabelText('Permission mode'), 'accept_edits');
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'deepseek-v4-pro');
    await userEvent.type(screen.getByLabelText('Message Megumi'), '  hello Megumi  ');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenCalledWith({
      message: 'hello Megumi',
      permissionMode: 'accept_edits',
      model: 'deepseek-v4-pro',
    });
    expect(screen.getByLabelText('Message Megumi')).toHaveValue('');
  });

  it('offers exactly the first-version permission posture choices', () => {
    render(<Composer onSubmit={() => undefined} />);

    expect(
      Array.from(screen.getByLabelText('Permission mode').querySelectorAll('option')).map((option) => [
        option.getAttribute('value'),
        option.textContent,
      ]),
    ).toEqual([
      ['default', 'Default'],
      ['accept_edits', 'Accept edits'],
      ['plan', 'Plan'],
      ['auto', 'Auto'],
    ]);
    expect(screen.queryByLabelText('Composer mode')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Chat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Execute' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Review' })).not.toBeInTheDocument();
  });

  it('submits with Enter and clears the input', async () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText('Message Megumi'), 'Send from keyboard');
    await userEvent.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledWith({
      message: 'Send from keyboard',
      permissionMode: 'default',
      model: 'deepseek-v4-flash',
    });
    expect(screen.getByLabelText('Message Megumi')).toHaveValue('');
  });

  it('keeps Shift+Enter and Alt+Enter as newline shortcuts without submitting', async () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);
    const input = screen.getByLabelText('Message Megumi');
    setTextareaScrollHeight(input, 96);

    await userEvent.click(input);
    await userEvent.keyboard('first line{Shift>}{Enter}{/Shift}second line{Alt>}{Enter}{/Alt}third line');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveValue('first line\nsecond line\nthird line');
    expect(input).toHaveStyle({ height: '96px' });
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

  it('renders a compact toolbar with context on the left and permission mode, model, and Send on the right', () => {
    render(<Composer onSubmit={() => undefined} />);

    const toolbar = screen.getByTestId('composer-toolbar');
    const leftControls = toolbar.firstElementChild;
    const rightControls = screen.getByTestId('composer-actions');

    expect(screen.getByRole('button', { name: 'Choose context' })).toHaveTextContent('Context');
    expect(screen.getByTestId('composer-input-panel')).toHaveClass('border-b');
    expect(toolbar).toHaveClass('justify-between');
    expect(toolbar).toHaveClass('flex-nowrap');
    expect(leftControls).toHaveTextContent('Context');
    expect(rightControls).toHaveClass('shrink-0');
    expect(rightControls.children).toHaveLength(3);
    expect(rightControls.children[0]).toContainElement(screen.getByLabelText('Permission mode'));
    expect(rightControls.children[1]).toContainElement(screen.getByLabelText('Model'));
    expect(rightControls.children[2]).toBe(screen.getByRole('button', { name: 'Send message' }));
    expect(screen.getByRole('button', { name: 'Send message' })).toHaveClass('shrink-0');
  });

  it('auto grows the textarea for multiline drafts while preserving a maximum height', async () => {
    render(<Composer onSubmit={() => undefined} />);
    const input = screen.getByLabelText('Message Megumi');

    expect(input).toHaveStyle({ height: '56px', overflowY: 'hidden' });

    setTextareaScrollHeight(input, 112);
    await userEvent.type(input, 'first line{Shift>}{Enter}{/Shift}second line');

    expect(input).toHaveStyle({ height: '112px', overflowY: 'hidden' });

    setTextareaScrollHeight(input, 220);
    await userEvent.type(input, '{Shift>}{Enter}{/Shift}third line{Shift>}{Enter}{/Shift}fourth line');

    expect(input).toHaveStyle({ height: '160px', overflowY: 'auto' });
  });

  it('restores the compact textarea height after sending clears the draft', async () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);
    const input = screen.getByLabelText('Message Megumi');

    setTextareaScrollHeight(input, 120);
    await userEvent.type(input, 'first line{Shift>}{Enter}{/Shift}second line');
    expect(input).toHaveStyle({ height: '120px' });

    setTextareaScrollHeight(input, 56);
    await userEvent.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue('');
    expect(input).toHaveStyle({ height: '56px', overflowY: 'hidden' });
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

    const rightControls = screen.getByTestId('composer-actions');

    expect(screen.getByText('Megumi is working')).toBeInTheDocument();
    expect(screen.getByLabelText('Message Megumi')).toHaveValue('continue');
    expect(screen.getByLabelText('Model')).toHaveValue('deepseek-v4-pro');
    expect(rightControls).toHaveTextContent('Default');
    expect(rightControls).toHaveTextContent('DeepSeek V4 Pro');
    expect(rightControls.lastElementChild).toBe(screen.getByRole('button', { name: 'Stop current run' }));
    expect(screen.getByRole('button', { name: 'Stop current run' })).toHaveClass('shrink-0');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('auto grows multiline follow-up drafts while a run is active', async () => {
    const onStop = vi.fn();
    render(<Composer status="running" onSubmit={() => undefined} onStop={onStop} />);
    const input = screen.getByLabelText('Message Megumi');

    setTextareaScrollHeight(input, 132);
    await userEvent.type(input, 'follow-up line one{Shift>}{Enter}{/Shift}follow-up line two');

    expect(input).toHaveValue('follow-up line one\nfollow-up line two');
    expect(input).toHaveStyle({ height: '132px', overflowY: 'hidden' });
    expect(screen.getByRole('button', { name: 'Stop current run' })).toBeEnabled();
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
      permissionMode: 'default',
      model: 'deepseek-v4-flash',
    });
  });
});
