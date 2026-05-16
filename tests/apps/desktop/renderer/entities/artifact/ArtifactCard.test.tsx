// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArtifactCard } from '@megumi/desktop/renderer/entities/artifact';

describe('ArtifactCard', () => {
  it('renders an active artifact without host path exposure', () => {
    render(
      <ArtifactCard
        artifact={{
          artifactId: 'artifact:1',
          title: 'Report',
          kind: 'report',
          status: 'active',
          textPreview: 'Safe preview',
          currentVersionId: 'artifact-version:1',
        }}
      />,
    );

    expect(screen.getByText('Report')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Safe preview')).toBeInTheDocument();
    expect(screen.queryByText(/C:\\/)).not.toBeInTheDocument();
  });

  it('renders a failed artifact status', () => {
    render(
      <ArtifactCard
        artifact={{
          artifactId: 'artifact:2',
          title: 'Patch draft',
          kind: 'code_snippet',
          status: 'failed',
          textPreview: '',
        }}
      />,
    );

    expect(screen.getByText('Patch draft')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});
