// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InputSuggestionPanel } from '@megumi/desktop/renderer/features/chat/components/InputSuggestionPanel';
import type { InputSuggestionQueryResult } from '@megumi/product/host';

describe('InputSuggestionPanel skill suggestions', () => {
  it('renders Skill fields and preserves the exact selected skillPath', () => {
    const onChoose = vi.fn();
    const suggestions: InputSuggestionQueryResult = {
      type: 'suggestions',
      draftInput: '/bra',
      queryPrefix: 'bra',
      groups: [{
        id: 'skills',
        label: 'Skills',
        items: [{
          kind: 'skill',
          name: 'brainstorming',
          description: 'Explore intent before implementation',
          sourceLabel: 'System',
          match: {
            field: 'name',
            value: 'brainstorming',
            prefix: 'bra',
          },
          replacementInput: '',
          selection: { type: 'skill', name: 'brainstorming', skillPath: 'C:/system/brainstorming/SKILL.md' },
        }],
      }],
    };

    render(
      <InputSuggestionPanel
        suggestions={suggestions}
        selectedIndex={0}
        onChoose={onChoose}
      />,
    );

    expect(screen.getByText('Brainstorming')).toBeInTheDocument();
    expect(screen.getByText('Explore intent before implementation')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByTestId('input-suggestion-icon-skill')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', {
      name: 'Brainstorming Explore intent before implementation System',
    }));

    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'skill',
      selection: { type: 'skill', name: 'brainstorming', skillPath: 'C:/system/brainstorming/SKILL.md' },
    }));
  });

  it('uses stable unique keys for same-name skill suggestions', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const suggestions: InputSuggestionQueryResult = {
      type: 'suggestions',
      draftInput: '/test',
      queryPrefix: 'test',
      groups: [{
        id: 'skills',
        label: 'Skills',
        items: [
          createSkillSuggestion('checks:test', 'Run project checks'),
          createSkillSuggestion('qa:test', 'Run QA checks'),
        ],
      }],
    };

    render(
      <InputSuggestionPanel
        suggestions={suggestions}
        selectedIndex={0}
        onChoose={vi.fn()}
      />,
    );

    expect(screen.getByText('Run project checks')).toBeInTheDocument();
    expect(screen.getByText('Run QA checks')).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('Encountered two children with the same key'));
    consoleError.mockRestore();
  });

  it('applies a visible accent style to the selected suggestion', () => {
    const suggestions: InputSuggestionQueryResult = {
      type: 'suggestions',
      draftInput: '/test',
      queryPrefix: 'test',
      groups: [{
        id: 'skills',
        label: 'Skills',
        items: [
          createSkillSuggestion('checks:test', 'Run project checks'),
          createSkillSuggestion('qa:test', 'Run QA checks'),
        ],
      }],
    };

    render(
      <InputSuggestionPanel
        suggestions={suggestions}
        selectedIndex={1}
        onChoose={vi.fn()}
      />,
    );

    const options = screen.getAllByRole('option');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveClass('aria-selected:bg-[var(--color-accent-soft)]');
    expect(options[1]).toHaveClass('aria-selected:shadow-[inset_3px_0_0_var(--color-accent)]');
    expect(options[0]).not.toHaveClass('aria-selected:bg-[var(--color-accent-soft)]');
  });

  it('gives pointer-hover suggestions a visible hover highlight', () => {
    const suggestions: InputSuggestionQueryResult = {
      type: 'suggestions',
      draftInput: '/test',
      queryPrefix: 'test',
      groups: [{
        id: 'skills',
        label: 'Skills',
        items: [createSkillSuggestion('checks:test', 'Run project checks')],
      }],
    };

    render(
      <InputSuggestionPanel
        suggestions={suggestions}
        selectedIndex={0}
        onChoose={vi.fn()}
      />,
    );

    expect(screen.getByRole('option')).toHaveClass('hover:bg-[var(--color-accent-soft)]');
  });
});

function createSkillSuggestion(
  skillPath: string,
  description: string,
): Extract<InputSuggestionQueryResult, { type: 'suggestions' }>['groups'][number]['items'][number] {
  return {
    kind: 'skill',
    name: 'test',
    description,
    sourceLabel: 'User',
    match: {
      field: 'name',
      value: 'test',
      prefix: 'test',
    },
    replacementInput: '',
    selection: { type: 'skill', name: 'test', skillPath },
  };
}
