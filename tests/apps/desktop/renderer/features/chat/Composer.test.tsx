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
    expect(screen.getByRole('button', { name: 'Send message' })).not.toHaveTextContent('Send');
  });

  it('themes native select dropdown options for dark and light themes', () => {
    render(<Composer onSubmit={() => undefined} />);

    for (const option of screen.getByLabelText('Permission mode').querySelectorAll('option')) {
      expect(option).toHaveClass('bg-[var(--color-surface-elevated)]');
      expect(option).toHaveClass('text-[var(--color-text)]');
    }

    for (const option of screen.getByLabelText('Model').querySelectorAll('option')) {
      expect(option).toHaveClass('bg-[var(--color-surface-elevated)]');
      expect(option).toHaveClass('text-[var(--color-text)]');
    }
  });

  it('shows command autocomplete with name and description for slash prefixes', async () => {
    render(<Composer onSubmit={() => undefined} />);
    const input = screen.getByLabelText('Message Megumi');

    await userEvent.type(input, '/');

    expect(screen.getByRole('listbox', { name: 'Command suggestions' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '/review Review code in the current project' })).toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, '/re');

    expect(screen.getByRole('option', { name: '/review Review code in the current project' })).toBeInTheDocument();
  });

  it('uses case-sensitive command autocomplete filtering', async () => {
    render(<Composer onSubmit={() => undefined} />);

    await userEvent.type(screen.getByLabelText('Message Megumi'), '/Review');

    expect(screen.queryByRole('listbox', { name: 'Command suggestions' })).not.toBeInTheDocument();
  });

  it('completes command autocomplete with Enter or Tab without submitting', async () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);
    const input = screen.getByLabelText('Message Megumi');

    await userEvent.type(input, '/re');
    await userEvent.keyboard('{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveValue('/review ');
    expect(screen.queryByRole('listbox', { name: 'Command suggestions' })).not.toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, '/re');
    await userEvent.keyboard('{Tab}');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveValue('/review ');
    expect(screen.queryByRole('listbox', { name: 'Command suggestions' })).not.toBeInTheDocument();
  });

  it('submits command arguments after autocomplete completes the command name', async () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);
    const input = screen.getByLabelText('Message Megumi');

    await userEvent.type(input, '/re');
    await userEvent.keyboard('{Enter}');
    await userEvent.type(input, '当前改动');
    await userEvent.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledWith({
      message: '/review 当前改动',
      permissionMode: 'plan',
      permissionSource: 'workflow_default',
      model: 'deepseek-v4-flash',
      workflow: {
        intent: 'code_review',
        source: 'builtin_command',
        commandName: 'review',
        argsText: '当前改动',
      },
    });
  });

  it('closes command autocomplete with Escape and keeps normal Enter submit behavior closed', async () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);
    const input = screen.getByLabelText('Message Megumi');

    await userEvent.type(input, '/re');
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('listbox', { name: 'Command suggestions' })).not.toBeInTheDocument();

    await userEvent.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledWith({
      message: '/re',
      permissionMode: 'default',
      model: 'deepseek-v4-flash',
    });
  });

  it('submits /review as a workflow command with plan workflow default permission', async () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText('Message Megumi'), '/review 当前改动');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenCalledWith({
      message: '/review 当前改动',
      permissionMode: 'plan',
      permissionSource: 'workflow_default',
      model: 'deepseek-v4-flash',
      workflow: {
        intent: 'code_review',
        source: 'builtin_command',
        commandName: 'review',
        argsText: '当前改动',
      },
    });
  });

  it('keeps unknown slash commands as ordinary messages', async () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText('Message Megumi'), '/unknown abc');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenCalledWith({
      message: '/unknown abc',
      permissionMode: 'default',
      model: 'deepseek-v4-flash',
    });
  });

  it('uses a stable floating composer shell without page-level width ownership', () => {
    render(<Composer onSubmit={() => undefined} />);

    const form = screen.getByRole('form', { name: 'Message composer' });
    expect(form).toHaveClass('w-full');
    expect(form).not.toHaveClass('min-w-[38rem]');
    expect(form).not.toHaveClass('max-w-3xl');
    expect(form).not.toHaveClass('px-6');
    expect(form).toHaveClass('transition-[width,transform,opacity]');
    expect(screen.getByTestId('composer-input-panel')).toHaveClass('px-4');
    expect(screen.getByTestId('composer-toolbar')).toHaveClass('px-3');
    expect(screen.getByTestId('composer-toolbar')).toHaveClass('min-h-12');
  });

  it('resets seed text when seedTextKey changes without rendering branch chrome', async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <Composer
        onSubmit={onSubmit}
        seedTextKey="branch-marker-1"
        seedText="original prompt"
      />,
    );

    expect(screen.getByLabelText('Message Megumi')).toHaveValue('original prompt');
    expect(screen.queryByRole('button', { name: 'Cancel branch' })).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Message Megumi'));
    await userEvent.type(screen.getByLabelText('Message Megumi'), 'edited prompt');

    rerender(
      <Composer
        onSubmit={onSubmit}
        seedTextKey="branch-marker-2"
        seedText="second prompt"
      />,
    );

    expect(screen.getByLabelText('Message Megumi')).toHaveValue('second prompt');
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

    expect(screen.queryByText('Sending')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message Megumi')).toHaveValue('Continue this plan');

    await userEvent.type(screen.getByLabelText('Message Megumi'), ' after this run');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Stop current run' }));

    expect(screen.getByLabelText('Message Megumi')).toHaveValue('Continue this plan after this run');
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('keeps the normal placeholder while running and uses Stop for the active run', async () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    render(<Composer status="running" onSubmit={onSubmit} onStop={onStop} />);

    expect(screen.getByPlaceholderText('Ask Megumi anything...')).toBeInTheDocument();
    expect(screen.queryByText('Megumi is working')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Message Megumi'), 'continue');
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'deepseek-v4-pro');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Stop current run' }));

    const rightControls = screen.getByTestId('composer-actions');

    expect(screen.getByLabelText('Message Megumi')).toHaveValue('continue');
    expect(screen.getByLabelText('Model')).toHaveValue('deepseek-v4-pro');
    expect(rightControls).toHaveTextContent('Default');
    expect(rightControls).toHaveTextContent('DeepSeek V4 Pro');
    expect(rightControls.lastElementChild).toBe(screen.getByRole('button', { name: 'Stop current run' }));
    expect(screen.getByRole('button', { name: 'Stop current run' })).toHaveClass('shrink-0');
    expect(screen.getByRole('button', { name: 'Stop current run' })).not.toHaveTextContent('Stop');
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

  it('locks input during approval without rendering approval status controls in the composer', () => {
    render(<Composer status="waiting-approval" onSubmit={() => undefined} />);

    expect(screen.queryByText('Waiting for approval')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review approval' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message Megumi')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('does not render run error status inside the composer', () => {
    render(
      <Composer
        status="error"
        onSubmit={() => undefined}
      />,
    );

    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
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
