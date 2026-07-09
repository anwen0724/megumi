// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '@megumi/desktop/renderer/features/chat/components/Composer';
import type { ComposerProps } from '@megumi/desktop/renderer/features/chat/components/composer-types';

const defaultProviders = [
  {
    providerId: 'deepseek' as const,
    displayName: 'DeepSeek',
    protocol: 'openai-compatible' as const,
    enabled: true,
    modelIds: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    hasApiKey: true,
    credentialSource: 'settings' as const,
    envOverrideActive: false,
  },
  {
    providerId: 'openai' as const,
    displayName: 'OpenAI',
    protocol: 'openai-compatible' as const,
    enabled: true,
    modelIds: ['gpt-5.5'],
    hasApiKey: true,
    credentialSource: 'settings' as const,
    envOverrideActive: false,
  },
];

const deepseekOnlyProviders = defaultProviders.map((provider) => ({
  ...provider,
  enabled: provider.providerId === 'deepseek',
}));

function TestComposer(props: ComposerProps) {
  return <Composer providers={defaultProviders} {...props} />;
}

function setTextareaScrollHeight(textarea: HTMLElement, scrollHeight: number) {
  Object.defineProperty(textarea, 'scrollHeight', {
    configurable: true,
    value: scrollHeight,
  });
}

describe('Composer', () => {
  it('renders permission mode, model, context usage, attachment, and disabled send controls', () => {
    render(<TestComposer onSubmit={() => undefined} />);

    expect(screen.getByLabelText('Permission mode')).toHaveValue('default');
    expect(screen.getByLabelText('Model')).toHaveValue('deepseek:deepseek-v4-flash');
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose context' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Context usage')).toBeInTheDocument();
    expect(screen.getByText('Context window:')).toBeInTheDocument();
    expect(screen.getByText('Usage not available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('renders context usage from the active session usage dto', () => {
    render(
      <TestComposer
        onSubmit={() => undefined}
        contextUsage={{
          status: 'ok',
          usage: {
            usedTokens: 222_000,
            totalTokens: 258_000,
            remainingTokens: 36_000,
            usedPercent: 86,
            autoCompactPercent: 80,
            shouldAutoCompact: true,
          },
        }}
      />,
    );

    expect(screen.getByText('Context window:')).toBeInTheDocument();
    expect(screen.getByText('86% used')).toBeInTheDocument();
    expect(screen.getByText('Used 222k tokens of 258k')).toBeInTheDocument();
    expect(screen.getByLabelText('Context usage')).toHaveAttribute('aria-valuenow', '86');
  });

  it('submits trimmed text with selected permission mode and model then clears the input', async () => {
    const onSubmit = vi.fn();
    render(<TestComposer onSubmit={onSubmit} />);

    await userEvent.selectOptions(screen.getByLabelText('Permission mode'), 'accept_edits');
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'deepseek:deepseek-v4-pro');
    await userEvent.type(screen.getByLabelText('Message Megumi'), '  hello Megumi  ');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenCalledWith({
      message: 'hello Megumi',
      permissionMode: 'accept_edits',
      providerId: 'deepseek',
      model: 'deepseek-v4-pro',
    });
    expect(screen.getByLabelText('Message Megumi')).toHaveValue('');
  });

  it('offers exactly the first-version permission posture choices', () => {
    render(<TestComposer onSubmit={() => undefined} />);

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
    render(<TestComposer onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText('Message Megumi'), 'Send from keyboard');
    await userEvent.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledWith({
      message: 'Send from keyboard',
      permissionMode: 'default',
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
    });
    expect(screen.getByLabelText('Message Megumi')).toHaveValue('');
  });

  it('keeps Shift+Enter and Alt+Enter as newline shortcuts without submitting', async () => {
    const onSubmit = vi.fn();
    render(<TestComposer onSubmit={onSubmit} />);
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
    render(<TestComposer onSubmit={onSubmit} />);
    const input = screen.getByLabelText('Message Megumi');

    fireEvent.change(input, { target: { value: 'nihao' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveValue('nihao');
  });

  it('opens the file picker and keeps the attachment callback hook', async () => {
    const onChooseContext = vi.fn();
    const onAttachFiles = vi.fn();

    render(
      <TestComposer
        onSubmit={() => undefined}
        onChooseContext={onChooseContext}
        onAttachFiles={onAttachFiles}
      />,
    );

    const fileInput = screen.getByTestId('composer-file-input') as HTMLInputElement;
    const fileInputClick = vi.spyOn(fileInput, 'click').mockImplementation(() => undefined);

    await userEvent.click(screen.getByRole('button', { name: 'Attach files' }));

    expect(screen.queryByRole('button', { name: 'Choose context' })).not.toBeInTheDocument();
    expect(onChooseContext).not.toHaveBeenCalled();
    expect(onAttachFiles).toHaveBeenCalledTimes(1);
    expect(fileInputClick).toHaveBeenCalledTimes(1);
  });

  it('renders a compact toolbar with attachment and context usage on the left, then permission mode, model, and Send on the right', () => {
    render(<TestComposer onSubmit={() => undefined} />);

    const toolbar = screen.getByTestId('composer-toolbar');
    const inputPanel = screen.getByTestId('composer-input-panel');
    const leftControls = toolbar.firstElementChild;
    const rightControls = screen.getByTestId('composer-actions');

    expect(inputPanel).toHaveClass('px-4');
    expect(inputPanel).toHaveClass('py-3');
    expect(inputPanel).not.toHaveClass('border-b');
    expect(toolbar).toHaveClass('justify-between');
    expect(toolbar).toHaveClass('flex-nowrap');
    expect(screen.queryByRole('button', { name: 'Choose context' })).not.toBeInTheDocument();
    expect(leftControls?.children[0]).toBe(screen.getByRole('button', { name: 'Attach files' }));
    expect(leftControls?.children[1]).toContainElement(screen.getByLabelText('Context usage'));
    expect(rightControls).toHaveClass('shrink-0');
    expect(rightControls.children).toHaveLength(3);
    expect(rightControls.children[0]).toContainElement(screen.getByLabelText('Permission mode'));
    expect(rightControls.children[1]).toContainElement(screen.getByLabelText('Model'));
    expect(rightControls.children[2]).toBe(screen.getByRole('button', { name: 'Send message' }));
    expect(screen.getByRole('button', { name: 'Send message' })).toHaveClass('shrink-0');
    expect(screen.getByRole('button', { name: 'Send message' })).not.toHaveTextContent('Send');
  });

  it('themes native select dropdown options for dark and light themes', () => {
    render(<TestComposer onSubmit={() => undefined} />);

    for (const option of screen.getByLabelText('Permission mode').querySelectorAll('option')) {
      expect(option).toHaveClass('bg-[var(--color-surface-elevated)]');
      expect(option).toHaveClass('text-[var(--color-text)]');
    }

    for (const option of screen.getByLabelText('Model').querySelectorAll('option')) {
      expect(option).toHaveClass('bg-[var(--color-surface-elevated)]');
      expect(option).toHaveClass('text-[var(--color-text)]');
    }
  });

  it('hides models whose providers are disabled', () => {
    render(<TestComposer providers={deepseekOnlyProviders} onSubmit={() => undefined} />);

    const modelOptions = Array.from(screen.getByLabelText('Model').querySelectorAll('option'));

    expect(modelOptions.map((option) => option.getAttribute('value'))).toEqual([
      'deepseek:deepseek-v4-flash',
      'deepseek:deepseek-v4-pro',
    ]);
    expect(screen.queryByRole('option', { name: 'gpt-5.5' })).not.toBeInTheDocument();
  });

  it('falls back when the selected model provider becomes disabled', async () => {
    const { rerender } = render(
      <TestComposer onSubmit={() => undefined} />,
    );

    await userEvent.selectOptions(screen.getByLabelText('Model'), 'openai:gpt-5.5');

    expect(screen.getByLabelText('Model')).toHaveValue('openai:gpt-5.5');

    rerender(<TestComposer providers={deepseekOnlyProviders} onSubmit={() => undefined} />);

    expect(screen.getByLabelText('Model')).toHaveValue('deepseek:deepseek-v4-flash');
    expect(screen.queryByRole('option', { name: 'gpt-5.5' })).not.toBeInTheDocument();
  });

  it('keeps slash prefixes as ordinary drafts until a trusted command catalog is wired in', async () => {
    render(<TestComposer onSubmit={() => undefined} />);
    const input = screen.getByLabelText('Message Megumi');

    await userEvent.type(input, '/');

    expect(screen.queryByRole('listbox', { name: 'Command suggestions' })).not.toBeInTheDocument();
  });

  it('renders command suggestions from the provider for slash drafts', async () => {
    render(<TestComposer
      onSubmit={() => undefined}
      getCommandSuggestions={() => ({
        type: 'suggestions',
        draft_input: '/',
        command_prefix: '',
        groups: [{
          id: 'commands',
          label: 'Commands',
          items: [{
            name: 'review',
            description: 'Evaluate review feedback before implementing changes',
            source: { kind: 'built_in' },
            match: { field: 'name', value: 'review', prefix: '' },
            completion: { replacement_input: '/review ' },
          }],
        }, {
          id: 'skills',
          label: 'Skills',
          items: [],
        }],
      })}
    />);

    await userEvent.type(screen.getByLabelText('Message Megumi'), '/');

    expect(screen.getByRole('listbox', { name: 'Command suggestions' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /review/i })).toBeInTheDocument();
  });

  it('uses Enter to complete the selected command suggestion without submitting', async () => {
    const onSubmit = vi.fn();
    render(<TestComposer
      onSubmit={onSubmit}
      getCommandSuggestions={() => ({
        type: 'suggestions',
        draft_input: '/re',
        command_prefix: 're',
        groups: [{
          id: 'commands',
          label: 'Commands',
          items: [{
            name: 'review',
            description: 'Evaluate review feedback before implementing changes',
            source: { kind: 'built_in' },
            match: { field: 'name', value: 'review', prefix: 're' },
            completion: { replacement_input: '/review ' },
          }],
        }],
      })}
    />);

    const input = screen.getByLabelText('Message Megumi');
    await userEvent.type(input, '/re');
    await userEvent.keyboard('{Enter}');

    expect(input).toHaveValue('/review ');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('uses Tab to complete the selected command suggestion without submitting', async () => {
    const onSubmit = vi.fn();
    render(<TestComposer
      onSubmit={onSubmit}
      getCommandSuggestions={() => ({
        type: 'suggestions',
        draft_input: '/re',
        command_prefix: 're',
        groups: [{
          id: 'commands',
          label: 'Commands',
          items: [{
            name: 'review',
            description: 'Evaluate review feedback before implementing changes',
            source: { kind: 'built_in' },
            match: { field: 'name', value: 'review', prefix: 're' },
            completion: { replacement_input: '/review ' },
          }],
        }],
      })}
    />);

    const input = screen.getByLabelText('Message Megumi');
    await userEvent.type(input, '/re');
    await userEvent.keyboard('{Tab}');

    expect(input).toHaveValue('/review ');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps Enter submit behavior when suggestions are inactive', async () => {
    const onSubmit = vi.fn();
    render(<TestComposer
      onSubmit={onSubmit}
      getCommandSuggestions={() => ({ type: 'inactive' })}
    />);

    await userEvent.type(screen.getByLabelText('Message Megumi'), 'hello');
    await userEvent.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      message: 'hello',
    }));
  });

  it('moves selected command suggestion with ArrowDown and ArrowUp', async () => {
    render(<TestComposer
      onSubmit={() => undefined}
      getCommandSuggestions={() => ({
        type: 'suggestions',
        draft_input: '/',
        command_prefix: '',
        groups: [{
          id: 'commands',
          label: 'Commands',
          items: [
            {
              name: 'review',
              description: 'Evaluate review feedback before implementing changes',
              source: { kind: 'built_in' },
              match: { field: 'name', value: 'review', prefix: '' },
              completion: { replacement_input: '/review ' },
            },
            {
              name: 'status',
              description: 'Show conversation status',
              source: { kind: 'built_in' },
              match: { field: 'name', value: 'status', prefix: '' },
              completion: { replacement_input: '/status ' },
            },
          ],
        }],
      })}
    />);

    await userEvent.type(screen.getByLabelText('Message Megumi'), '/');
    await userEvent.keyboard('{ArrowDown}');

    expect(screen.getByRole('option', { name: /status/i })).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('option', { name: /review/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('submits slash-prefixed text without renderer-owned preprocessing', async () => {
    const onSubmit = vi.fn();
    render(<TestComposer onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText('Message Megumi'), '/review 当前改动');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenCalledWith({
      message: '/review 当前改动',
      permissionMode: 'default',
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
    });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('intent');
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('workflow');
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('permissionSource');
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('preprocessing');
  });

  it('keeps unknown slash commands as ordinary messages', async () => {
    const onSubmit = vi.fn();
    render(<TestComposer onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText('Message Megumi'), '/unknown abc');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenCalledWith({
      message: '/unknown abc',
      permissionMode: 'default',
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
    });
  });

  it('uses a stable floating composer shell without page-level width ownership', () => {
    render(<TestComposer onSubmit={() => undefined} />);

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
      <TestComposer
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
      <TestComposer
        onSubmit={onSubmit}
        seedTextKey="branch-marker-2"
        seedText="second prompt"
      />,
    );

    expect(screen.getByLabelText('Message Megumi')).toHaveValue('second prompt');
  });

  it('auto grows the textarea for multiline drafts while preserving a maximum height', async () => {
    render(<TestComposer onSubmit={() => undefined} />);
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
    render(<TestComposer onSubmit={onSubmit} />);
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
    render(<TestComposer status="sending" onSubmit={onSubmit} onStop={onStop} initialValue="Continue this plan" />);

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
    render(<TestComposer status="running" onSubmit={onSubmit} onStop={onStop} />);

    expect(screen.getByPlaceholderText('Ask Megumi anything...')).toBeInTheDocument();
    expect(screen.queryByText('Megumi is working')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Message Megumi'), 'continue');
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'deepseek:deepseek-v4-pro');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Stop current run' }));

    const rightControls = screen.getByTestId('composer-actions');

    expect(screen.getByLabelText('Message Megumi')).toHaveValue('continue');
    expect(screen.getByLabelText('Model')).toHaveValue('deepseek:deepseek-v4-pro');
    expect(rightControls).toHaveTextContent('Default');
    expect(rightControls).toHaveTextContent('deepseek-v4-pro');
    expect(rightControls.lastElementChild).toBe(screen.getByRole('button', { name: 'Stop current run' }));
    expect(screen.getByRole('button', { name: 'Stop current run' })).toHaveClass('shrink-0');
    expect(screen.getByRole('button', { name: 'Stop current run' })).not.toHaveTextContent('Stop');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('auto grows multiline follow-up drafts while a run is active', async () => {
    const onStop = vi.fn();
    render(<TestComposer status="running" onSubmit={() => undefined} onStop={onStop} />);
    const input = screen.getByLabelText('Message Megumi');

    setTextareaScrollHeight(input, 132);
    await userEvent.type(input, 'follow-up line one{Shift>}{Enter}{/Shift}follow-up line two');

    expect(input).toHaveValue('follow-up line one\nfollow-up line two');
    expect(input).toHaveStyle({ height: '132px', overflowY: 'hidden' });
    expect(screen.getByRole('button', { name: 'Stop current run' })).toBeEnabled();
  });

  it('does not render an enabled Stop button without a stop handler', () => {
    render(<TestComposer status="running" onSubmit={() => undefined} />);

    expect(screen.getByRole('button', { name: 'Stop current run' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
  });

  it('keeps drafting available during approval and exposes Stop for the active run', async () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();

    render(<TestComposer status="waiting-approval" onSubmit={onSubmit} onStop={onStop} />);

    expect(screen.queryByText('Waiting for approval')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review approval' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message Megumi')).toBeEnabled();
    expect(screen.getByLabelText('Permission mode')).toBeEnabled();
    expect(screen.getByLabelText('Model')).toBeEnabled();

    await userEvent.type(screen.getByLabelText('Message Megumi'), 'new draft while waiting');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Stop current run' }));

    expect(screen.getByLabelText('Message Megumi')).toHaveValue('new draft while waiting');
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('does not render run error status inside the composer', () => {
    render(
      <TestComposer
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
      <TestComposer
        status="error"
        onSubmit={onSubmit}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText('Model'), 'deepseek:deepseek-v4-flash');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits a new draft after an error with the selected model', async () => {
    const onSubmit = vi.fn();

    render(
      <TestComposer
        status="error"
        onSubmit={onSubmit}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText('Model'), 'deepseek:deepseek-v4-flash');
    await userEvent.type(screen.getByLabelText('Message Megumi'), 'try again normally');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenCalledWith({
      message: 'try again normally',
      permissionMode: 'default',
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
    });
  });
});
