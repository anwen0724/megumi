// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePermissionModeStore } from '@megumi/desktop/renderer/entities/permission-mode';
import { useModelSelectionStore } from '@megumi/desktop/renderer/entities/model-selection';
import { Composer } from '@megumi/desktop/renderer/features/chat/components/Composer';
import type { ComposerProps } from '@megumi/desktop/renderer/features/chat/components/composer-types';
import type { ProviderPublicStatusUiDto } from '@megumi/product/host-interface';

const defaultProviders: ProviderPublicStatusUiDto[] = [
  {
    providerId: 'deepseek' as const,
    displayName: 'DeepSeek',
    protocol: 'openai-completions' as const,
    enabled: true,
    modelIds: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    modelCapabilities: {
      'deepseek-v4-flash': { streaming: true, toolCalls: true, thinking: true, imageInput: true },
      'deepseek-v4-pro': { streaming: true, toolCalls: true, thinking: true, imageInput: true },
    },
    hasApiKey: true,
    credentialSource: 'settings' as const,
    envOverrideActive: false,
  },
  {
    providerId: 'openai' as const,
    displayName: 'OpenAI',
    protocol: 'openai-completions' as const,
    enabled: true,
    modelIds: ['gpt-5.5'],
    modelCapabilities: { 'gpt-5.5': { streaming: true, toolCalls: true, thinking: true, imageInput: true } },
    hasApiKey: true,
    credentialSource: 'settings' as const,
    envOverrideActive: false,
  },
];

const deepseekOnlyProviders = defaultProviders.map((provider) => ({
  ...provider,
  enabled: provider.providerId === 'deepseek',
}));

const textOnlyProviders = defaultProviders.map((provider) => ({
  ...provider,
  modelCapabilities: Object.fromEntries(
    Object.entries(provider.modelCapabilities ?? {}).map(([modelId, capabilities]) => [
      modelId,
      { ...capabilities, imageInput: false as const },
    ]),
  ),
}));

function TestComposer(props: ComposerProps) {
  return (
    <Composer
      providers={defaultProviders}
      imageInputCapabilities={{
        allowedMediaTypes: ['image/png', 'image/jpeg', 'image/webp'],
        maxImageCount: 5,
        maxImageBytes: 10 * 1024 * 1024,
        maxTotalBytes: 25 * 1024 * 1024,
        maxDocumentCount: 10,
        maxDocumentBytes: 50 * 1024 * 1024,
        allowedDocumentMediaTypes: [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
          'text/markdown',
        ],
      }}
      {...props}
    />
  );
}

function setTextareaScrollHeight(textarea: HTMLElement, scrollHeight: number) {
  Object.defineProperty(textarea, 'scrollHeight', {
    configurable: true,
    value: scrollHeight,
  });
}

async function selectImageFromAttachmentMenu() {
  await userEvent.click(screen.getByRole('button', { name: 'Attach files' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Attach images' }));
}

async function chooseComposerOption(controlLabel: 'Permission mode' | 'Model', optionName: string | RegExp) {
  await userEvent.click(screen.getByRole('button', { name: controlLabel }));
  await userEvent.click(screen.getByRole('option', { name: optionName }));
}

describe('Composer', () => {
  beforeEach(() => {
    usePermissionModeStore.setState({ mode: 'ask' });
    useModelSelectionStore.setState(useModelSelectionStore.getInitialState(), true);
  });

  it('renders permission mode, model, context usage, attachment, and disabled send controls', () => {
    render(<TestComposer onSubmit={() => undefined} />);

    expect(screen.getByLabelText('Permission mode')).toHaveAttribute('value', 'ask');
    expect(screen.getByLabelText('Model')).toHaveAttribute('value', 'deepseek:deepseek-v4-flash');
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
          status: 'available',
          usage: {
            usedTokens: 222_000,
            totalTokens: 258_000,
            remainingTokens: 36_000,
            usedPercent: 86,
            autoCompactPercent: 80,
            accuracy: 'provider_reported',
          },
        }}
      />,
    );

    expect(screen.getByText('Context window:')).toBeInTheDocument();
    expect(screen.getByText('86% used')).toBeInTheDocument();
    expect(screen.getByText('Used 222K tokens of 258K')).toBeInTheDocument();
    expect(screen.getByLabelText('Context usage')).toHaveAttribute('aria-valuenow', '86');
  });

  it('shows not available when the active session has no completed-run snapshot', () => {
    render(
      <TestComposer
        onSubmit={() => undefined}
        contextUsage={{ status: 'not_available' }}
      />,
    );

    expect(screen.getByText('Usage not available')).toBeInTheDocument();
    expect(screen.queryByText('Calculating usage...')).not.toBeInTheDocument();
    expect(screen.queryByText('Context usage will update shortly.')).not.toBeInTheDocument();
  });

  it('submits trimmed text with selected permission mode and model then clears the input', async () => {
    const onSubmit = vi.fn();
    render(<TestComposer onSubmit={onSubmit} />);

    await chooseComposerOption('Permission mode', 'Approve for me');
    await chooseComposerOption('Model', /deepseek-v4-pro/);
    await userEvent.type(screen.getByLabelText('Message Megumi'), '  hello Megumi  ');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenCalledWith({
      message: 'hello Megumi',
      permissionMode: 'auto',
      providerId: 'deepseek',
      model: 'deepseek-v4-pro',
    });
    expect(screen.getByLabelText('Message Megumi')).toHaveValue('');
  });

  it('offers exactly the Agent Action Permission modes', async () => {
    render(<TestComposer onSubmit={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: 'Permission mode' }));

    expect(
      screen.getAllByRole('option').map((option) => [
        option.getAttribute('value'),
        option.textContent,
      ]),
    ).toEqual([
      ['ask', 'Ask for approval'],
      ['auto', 'Approve for me'],
      ['full_access', 'Full access'],
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
      permissionMode: 'ask',
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

  it('uses the host image picker and previews the selected image', async () => {
    const onChooseContext = vi.fn();
    const onAttachFiles = vi.fn();

    render(
      <TestComposer
        onSubmit={() => undefined}
        onChooseContext={onChooseContext}
        onSelectImages={async () => { onAttachFiles(); return [{ type: 'image', draftAttachmentId: 'draft-1', name: 'image.png', declaredMimeType: 'image/png', referenceId: 'ref-1', previewDataUrl: 'data:image/png;base64,aQ==' }]; }}
      />,
    );

    await selectImageFromAttachmentMenu();

    expect(screen.queryByRole('button', { name: 'Choose context' })).not.toBeInTheDocument();
    expect(onChooseContext).not.toHaveBeenCalled();
    expect(onAttachFiles).toHaveBeenCalledTimes(1);
    expect(await screen.findByAltText('image.png')).toBeInTheDocument();
  });

  it('selects a document from the shared attachment menu and submits the same draft attachment', async () => {
    const onSubmit = vi.fn();
    const document = {
      type: 'file' as const,
      draftAttachmentId: 'draft-document-1',
      name: 'notes.pdf',
      declaredMimeType: 'application/pdf',
      sizeBytes: 4096,
      referenceId: 'document-reference-1',
    };
    render(
      <TestComposer
        onSubmit={onSubmit}
        onSelectDocuments={async () => [document]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Attach documents' }));
    expect(await screen.findByText('notes.pdf')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ attachments: [document] }));
  });

  it('allows image attachments for a text-only model and explains the model-facing degradation', async () => {
    const onSubmit = vi.fn();
    render(
      <TestComposer
        providers={textOnlyProviders}
        onSubmit={onSubmit}
        onSelectImages={async () => [{
          type: 'image',
          draftAttachmentId: 'draft-text-only',
          name: 'diagram.png',
          declaredMimeType: 'image/png',
          referenceId: 'ref-text-only',
          previewDataUrl: 'data:image/png;base64,AQID',
        }]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Attach files' })).toBeEnabled();
    await selectImageFromAttachmentMenu();

    expect(await screen.findByAltText('diagram.png')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'This model will receive attachment metadata, but not the image content.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [expect.objectContaining({ name: 'diagram.png' })],
    }));
  });

  it('imports a pasted clipboard image without blocking native text paste', async () => {
    const onPasteImage = vi.fn(async () => [{
      type: 'image' as const,
      draftAttachmentId: 'draft-paste',
      name: 'clipboard-image.png',
      declaredMimeType: 'image/png',
      referenceId: 'ref-paste',
      previewDataUrl: 'data:image/png;base64,AQID',
    }]);
    render(<TestComposer onSubmit={() => undefined} onPasteImage={onPasteImage} />);
    const input = screen.getByLabelText('Message Megumi');

    const pasteResult = fireEvent.paste(input, {
      clipboardData: {
        items: [
          { kind: 'string', type: 'text/plain' },
          { kind: 'file', type: 'image/png' },
        ],
      },
    });

    expect(pasteResult).toBe(true);
    expect(onPasteImage).toHaveBeenCalledTimes(1);
    expect(await screen.findByAltText('clipboard-image.png')).toBeInTheDocument();
  });

  it('restores the complete in-memory draft after the composer remounts', async () => {
    let draft: Parameters<NonNullable<ComposerProps['onDraftChange']>>[0] = {
      text: '',
      attachments: [],
    };
    const onDraftChange = vi.fn((nextDraft: typeof draft) => {
      draft = nextDraft;
    });
    const selectedImage = {
      type: 'image' as const,
      draftAttachmentId: 'draft-restored',
      name: 'restored.png',
      declaredMimeType: 'image/png',
      referenceId: 'ref-restored',
      previewDataUrl: 'data:image/png;base64,AQID',
    };
    const first = render(
      <TestComposer
        onSubmit={() => undefined}
        onSelectImages={async () => [selectedImage]}
        onDraftChange={onDraftChange}
      />,
    );

    await userEvent.type(screen.getByLabelText('Message Megumi'), 'Keep this draft');
    await selectImageFromAttachmentMenu();
    await waitFor(() => expect(draft).toEqual({ text: 'Keep this draft', attachments: [selectedImage] }));
    first.unmount();

    render(
      <TestComposer
        initialValue={draft.text}
        initialAttachments={draft.attachments}
        onSubmit={() => undefined}
        onDraftChange={onDraftChange}
      />,
    );

    expect(screen.getByLabelText('Message Megumi')).toHaveValue('Keep this draft');
    expect(screen.getByAltText('restored.png')).toBeInTheDocument();
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
    expect(leftControls?.children[0]).toContainElement(screen.getByRole('button', { name: 'Attach files' }));
    expect(leftControls?.children[1]).toContainElement(screen.getByLabelText('Context usage'));
    expect(rightControls).toHaveClass('shrink-0');
    expect(rightControls.children).toHaveLength(3);
    expect(rightControls.children[0]).toContainElement(screen.getByLabelText('Permission mode'));
    expect(rightControls.children[1]).toContainElement(screen.getByLabelText('Model'));
    expect(rightControls.children[2]).toBe(screen.getByRole('button', { name: 'Send message' }));
    expect(screen.getByRole('button', { name: 'Send message' })).toHaveClass('shrink-0');
    expect(screen.getByRole('button', { name: 'Send message' })).not.toHaveTextContent('Send');
  });

  it('keeps the selected provider and model when the Composer remounts', async () => {
    const first = render(<TestComposer onSubmit={() => undefined} />);
    await chooseComposerOption('Model', /deepseek-v4-pro/);

    expect(useModelSelectionStore.getState().selection).toEqual({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-pro',
    });

    first.unmount();
    render(<TestComposer onSubmit={() => undefined} />);
    expect(screen.getByLabelText('Model')).toHaveAttribute('value', 'deepseek:deepseek-v4-pro');
  });

  it('renders a theme-aware popup with a strongly highlighted selected option', async () => {
    render(<TestComposer onSubmit={() => undefined} />);

    await userEvent.click(screen.getByRole('button', { name: 'Permission mode' }));
    expect(screen.getByRole('listbox', { name: 'Permission mode' })).toHaveClass('bg-[var(--color-surface-elevated)]');
    expect(screen.getByRole('option', { name: 'Ask for approval' })).toHaveClass('bg-[var(--color-accent)]');
    expect(screen.getByRole('option', { name: 'Ask for approval' })).toHaveClass('text-[var(--color-accent-foreground)]');
  });

  it('hides models whose providers are disabled', async () => {
    render(<TestComposer providers={deepseekOnlyProviders} onSubmit={() => undefined} />);

    await userEvent.click(screen.getByRole('button', { name: 'Model' }));
    const modelOptions = screen.getAllByRole('option');

    expect(modelOptions.map((option) => option.getAttribute('value'))).toEqual([
      'deepseek:deepseek-v4-flash',
      'deepseek:deepseek-v4-pro',
    ]);
    expect(screen.queryByRole('option', { name: /gpt-5.5/ })).not.toBeInTheDocument();
  });

  it('falls back when the selected model provider becomes disabled', async () => {
    const { rerender } = render(
      <TestComposer onSubmit={() => undefined} />,
    );

    await chooseComposerOption('Model', /gpt-5.5/);

    expect(screen.getByLabelText('Model')).toHaveAttribute('value', 'openai:gpt-5.5');

    rerender(<TestComposer providers={deepseekOnlyProviders} onSubmit={() => undefined} />);

    expect(screen.getByLabelText('Model')).toHaveAttribute('value', 'deepseek:deepseek-v4-flash');
    await userEvent.click(screen.getByRole('button', { name: 'Model' }));
    expect(screen.queryByRole('option', { name: /gpt-5.5/ })).not.toBeInTheDocument();
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
            displayInput: '/review ', submitInput: '/review ',
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

  it('floats command suggestions above the composer without taking layout space', async () => {
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
            displayInput: '/review ', submitInput: '/review ',
          }],
        }],
      })}
    />);

    await userEvent.type(screen.getByLabelText('Message Megumi'), '/');

    const form = screen.getByRole('form', { name: 'Message composer' });
    const panel = screen.getByRole('listbox', { name: 'Command suggestions' });

    expect(form).toHaveClass('relative');
    expect(panel).toHaveClass('absolute');
    expect(panel).toHaveClass('bottom-full');
    expect(panel).toHaveClass('left-0');
    expect(panel).toHaveClass('right-0');
    expect(panel).toHaveClass('z-50');
    expect(panel).toHaveClass('max-h-[min(22rem,calc(100vh-12rem))]');
    expect(panel).toHaveClass('overflow-y-auto');
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
            displayInput: '/review ', submitInput: '/review ',
          }],
        }],
      })}
    />);

    const input = screen.getByLabelText('Message Megumi');
    await userEvent.type(input, '/re');
    await userEvent.keyboard('{Enter}');

    expect(screen.getByTestId('composer-command-chip')).toHaveTextContent('Review');
    expect(input).toHaveValue('');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the selected Skill name and submits task text with an exact Skill selection', async () => {
    const onSubmit = vi.fn();
    render(<TestComposer
      onSubmit={onSubmit}
      getCommandSuggestions={() => ({
        type: 'suggestions',
        draft_input: '/te',
        command_prefix: 'te',
        groups: [{
          id: 'skills',
          label: 'Skills',
          items: [{
            name: 'test',
            description: 'Run project checks',
            source: { kind: 'skill', name: 'test', skillPath: 'C:/user/checks/SKILL.md' },
            display: {
              primary: 'test',
              secondary: 'Run project checks',
              badge: 'User',
            },
            match: { field: 'name', value: 'test', prefix: 'te' },
            displayInput: '/test ', submitInput: '',
            selection: { type: 'skill', name: 'test', skillPath: 'C:/user/checks/SKILL.md' },
          }],
        }],
      })}
    />);

    const input = screen.getByLabelText('Message Megumi');
    await userEvent.type(input, '/te');
    await userEvent.keyboard('{Enter}');

    expect(screen.getByTestId('composer-command-chip')).toHaveTextContent('Test');
    expect(screen.getByTestId('composer-command-chip')).toHaveClass('bg-[var(--color-accent-soft)]');
    expect(input).toHaveValue('');
    expect(onSubmit).not.toHaveBeenCalled();

    await userEvent.type(input, '--watch');
    await userEvent.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      message: '--watch',
      skillSelection: { type: 'skill', name: 'test', skillPath: 'C:/user/checks/SKILL.md' },
    }));
  });

  it('keeps the normal compact input height after choosing a command suggestion', async () => {
    render(<TestComposer
      onSubmit={() => undefined}
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
            displayInput: '/review ', submitInput: '/review ',
          }],
        }],
      })}
    />);

    const input = screen.getByLabelText('Message Megumi');
    await userEvent.type(input, '/re');
    await userEvent.keyboard('{Enter}');

    expect(screen.getByTestId('composer-command-chip')).toHaveTextContent('Review');
    expect(input).toHaveStyle({ height: '56px' });
  });

  it('does not convert a typed skill display command without choosing a suggestion', async () => {
    const onSubmit = vi.fn();
    render(<TestComposer
      onSubmit={onSubmit}
      getCommandSuggestions={({ draft_input }) => {
        if (/\s/.test(draft_input.slice(1))) {
          return { type: 'inactive' };
        }

        return {
          type: 'suggestions',
          draft_input,
          command_prefix: draft_input.slice(1),
          groups: [{
            id: 'skills',
            label: 'Skills',
            items: [{
              name: 'test',
              description: 'Run project checks',
              source: { kind: 'skill', name: 'test', skillPath: 'C:/user/checks/SKILL.md' },
              display: {
                primary: 'test',
                secondary: 'Run project checks',
                badge: 'User',
              },
              match: { field: 'name', value: 'test', prefix: draft_input.slice(1) },
              displayInput: '/test ', submitInput: '',
              selection: { type: 'skill', name: 'test', skillPath: 'C:/user/checks/SKILL.md' },
            }],
          }],
        };
      }}
    />);

    await userEvent.type(screen.getByLabelText('Message Megumi'), '/test --watch');
    await userEvent.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      message: '/test --watch',
    }));
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
            displayInput: '/review ', submitInput: '/review ',
          }],
        }],
      })}
    />);

    const input = screen.getByLabelText('Message Megumi');
    await userEvent.type(input, '/re');
    await userEvent.keyboard('{Tab}');

    expect(screen.getByTestId('composer-command-chip')).toHaveTextContent('Review');
    expect(input).toHaveValue('');
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
              displayInput: '/review ', submitInput: '/review ',
            },
            {
              name: 'status',
              description: 'Show conversation status',
              source: { kind: 'built_in' },
              match: { field: 'name', value: 'status', prefix: '' },
              displayInput: '/status ', submitInput: '/status ',
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
      permissionMode: 'ask',
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
      permissionMode: 'ask',
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

  it('consumes the shared draft before an asynchronous first send can remount the composer', async () => {
    let resolveSubmit: ((value: boolean) => void) | undefined;
    let draft: Parameters<NonNullable<ComposerProps['onDraftChange']>>[0] = { text: '', attachments: [] };
    const onDraftChange = vi.fn((nextDraft: typeof draft) => {
      draft = nextDraft;
    });
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveSubmit = resolve;
    }));

    render(<TestComposer onSubmit={onSubmit} onDraftChange={onDraftChange} />);
    const input = screen.getByLabelText('Message Megumi');
    await userEvent.type(input, 'first message');
    await waitFor(() => expect(draft.text).toBe('first message'));

    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue('');
    expect(draft).toEqual({ text: '', attachments: [] });

    resolveSubmit?.(true);
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

    expect(screen.getByPlaceholderText('Ask Megumi anything…')).toBeInTheDocument();
    expect(screen.queryByText('Megumi is working')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Message Megumi'), 'continue');
    await chooseComposerOption('Model', /deepseek-v4-pro/);
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Stop current run' }));

    const rightControls = screen.getByTestId('composer-actions');

    expect(screen.getByLabelText('Message Megumi')).toHaveValue('continue');
    expect(screen.getByLabelText('Model')).toHaveAttribute('value', 'deepseek:deepseek-v4-pro');
    expect(rightControls).toHaveTextContent('Ask for approval');
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

    await chooseComposerOption('Model', /deepseek-v4-flash/);
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

    await chooseComposerOption('Model', /deepseek-v4-flash/);
    await userEvent.type(screen.getByLabelText('Message Megumi'), 'try again normally');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenCalledWith({
      message: 'try again normally',
      permissionMode: 'ask',
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
    });
  });

  it('submits an image-only draft and removes the preview after submit', async () => {
    const onSubmit = vi.fn();
    render(<TestComposer onSubmit={onSubmit} onSelectImages={async () => [{
      type: 'image', draftAttachmentId: 'draft-1', name: 'diagram.png', declaredMimeType: 'image/png',
      referenceId: 'ref-1', previewDataUrl: 'data:image/png;base64,AQID',
    }]} />);
    await selectImageFromAttachmentMenu();
    expect(await screen.findByAltText('diagram.png')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSubmit).toHaveBeenCalledWith({
      message: '', permissionMode: 'ask', providerId: 'deepseek', model: 'deepseek-v4-flash',
      attachments: [{
        type: 'image', draftAttachmentId: 'draft-1', name: 'diagram.png', declaredMimeType: 'image/png',
        referenceId: 'ref-1', previewDataUrl: 'data:image/png;base64,AQID',
      }],
    });
    expect(screen.queryByAltText('diagram.png')).not.toBeInTheDocument();
  });

  it('restores the image draft when the host rejects the consumed submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    render(<TestComposer onSubmit={onSubmit} onSelectImages={async () => [{
      type: 'image', draftAttachmentId: 'draft-1', name: 'diagram.png', declaredMimeType: 'image/png',
      referenceId: 'ref-1', previewDataUrl: 'data:image/png;base64,AQID',
    }]} />);

    await selectImageFromAttachmentMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByAltText('diagram.png')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });
});
