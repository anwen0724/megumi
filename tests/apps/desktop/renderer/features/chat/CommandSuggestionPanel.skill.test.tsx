// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandSuggestionPanel } from '@megumi/desktop/renderer/features/chat/components/CommandSuggestionPanel';
import type { CommandSuggestionResult } from '@megumi/coding-agent/commands';

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
          completion: {
            replacement_input: '/skill superpowers:brainstorming ',
          },
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

    expect(screen.getByText('bra')).toBeInTheDocument();
    expect(screen.getByText('superpowers:brainstorming - Explore intent before implementation')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', {
      name: '/brainstorming superpowers:brainstorming - Explore intent before implementation System',
    }));

    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({
      completion: {
        replacement_input: '/skill superpowers:brainstorming ',
      },
    }));
  });
});
