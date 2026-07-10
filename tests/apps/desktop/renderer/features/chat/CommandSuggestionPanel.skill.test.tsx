// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandSuggestionPanel } from '@megumi/desktop/renderer/features/chat/components/CommandSuggestionPanel';
import type { CommandSuggestionResult } from '@megumi/product/host-interface';

describe('CommandSuggestionPanel skill suggestions', () => {
  it('renders skill command display fields and returns the replacement input on choose', () => {
    const onChoose = vi.fn();
    const suggestions: CommandSuggestionResult = {
      type: 'suggestions',
      draft_input: '/bra',
      command_prefix: 'bra',
      groups: [{
        id: 'skills',
        label: 'Skills',
        items: [{
          name: 'brainstorming',
          description: 'Explore intent before implementation',
          source: { kind: 'skill', skill_id: 'superpowers:brainstorming' },
          display: {
            primary: 'brainstorming',
            secondary: 'superpowers:brainstorming - Explore intent before implementation',
            badge: 'System',
          },
          match: {
            field: 'name',
            value: 'brainstorming',
            prefix: 'bra',
          },
          displayInput: '/brainstorming ',
          submitInput: '/skill superpowers:brainstorming ',
        }],
      }],
    };

    render(
      <CommandSuggestionPanel
        suggestions={suggestions}
        selectedIndex={0}
        onChoose={onChoose}
      />,
    );

    expect(screen.getByText('Brainstorming')).toBeInTheDocument();
    expect(screen.getByText('superpowers:brainstorming - Explore intent before implementation')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByTestId('command-suggestion-icon-skill')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', {
      name: 'Brainstorming superpowers:brainstorming - Explore intent before implementation System',
    }));

    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({
      displayInput: '/brainstorming ',
      submitInput: '/skill superpowers:brainstorming ',
    }));
  });

  it('uses stable unique keys for same-name skill suggestions', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const suggestions: CommandSuggestionResult = {
      type: 'suggestions',
      draft_input: '/test',
      command_prefix: 'test',
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
      <CommandSuggestionPanel
        suggestions={suggestions}
        selectedIndex={0}
        onChoose={vi.fn()}
      />,
    );

    expect(screen.getByText('checks:test - Run project checks')).toBeInTheDocument();
    expect(screen.getByText('qa:test - Run QA checks')).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('Encountered two children with the same key'));
    consoleError.mockRestore();
  });

  it('applies a visible accent style to the selected suggestion', () => {
    const suggestions: CommandSuggestionResult = {
      type: 'suggestions',
      draft_input: '/test',
      command_prefix: 'test',
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
      <CommandSuggestionPanel
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
    const suggestions: CommandSuggestionResult = {
      type: 'suggestions',
      draft_input: '/test',
      command_prefix: 'test',
      groups: [{
        id: 'skills',
        label: 'Skills',
        items: [createSkillSuggestion('checks:test', 'Run project checks')],
      }],
    };

    render(
      <CommandSuggestionPanel
        suggestions={suggestions}
        selectedIndex={0}
        onChoose={vi.fn()}
      />,
    );

    expect(screen.getByRole('option')).toHaveClass('hover:bg-[var(--color-accent-soft)]');
  });
});

function createSkillSuggestion(
  skillId: string,
  description: string,
): Extract<CommandSuggestionResult, { type: 'suggestions' }>['groups'][number]['items'][number] {
  return {
    name: 'test',
    description,
    source: { kind: 'skill', skill_id: skillId },
    display: {
      primary: 'test',
      secondary: `${skillId} - ${description}`,
      badge: 'Project',
    },
    match: {
      field: 'name',
      value: 'test',
      prefix: 'test',
    },
    displayInput: '/test ',
    submitInput: `/skill ${skillId} `,
  };
}
