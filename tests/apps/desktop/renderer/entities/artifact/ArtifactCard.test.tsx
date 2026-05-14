// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArtifactCard } from '@megumi/desktop/renderer/entities/artifact';

describe('ArtifactCard', () => {
  it('renders a created artifact with path', () => {
    render(
      <ArtifactCard
        artifact={{
          id: 'artifact-1',
          title: 'UI redesign plan',
          type: 'task_list',
          status: 'created',
          filePath: 'docs/superpowers/plans/plan.md',
        }}
      />,
    );

    expect(screen.getByText('UI redesign plan')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('docs/superpowers/plans/plan.md')).toBeInTheDocument();
  });

  it('renders a failed artifact status', () => {
    render(
      <ArtifactCard
        artifact={{
          id: 'artifact-2',
          title: 'Patch draft',
          type: 'code',
          status: 'failed',
          filePath: null,
        }}
      />,
    );

    expect(screen.getByText('Patch draft')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});
