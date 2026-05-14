// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryNoteCard } from '@megumi/desktop/renderer/entities/memory';

describe('MemoryNoteCard', () => {
  it('renders a preference note', () => {
    render(
      <MemoryNoteCard
        note={{
          id: 'memory-1',
          kind: 'preference',
          title: 'UI preference',
          body: 'Prefers warm, low-contrast desktop UI.',
        }}
      />,
    );

    expect(screen.getByText('UI preference')).toBeInTheDocument();
    expect(screen.getByText('Preference')).toBeInTheDocument();
    expect(screen.getByText('Prefers warm, low-contrast desktop UI.')).toBeInTheDocument();
  });
});
