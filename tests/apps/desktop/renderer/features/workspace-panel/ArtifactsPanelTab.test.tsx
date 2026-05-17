// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArtifactsPanelTab } from '@megumi/desktop/renderer/features/workspace-panel';
import { useArtifactStore } from '@megumi/desktop/renderer/entities/artifact';

describe('ArtifactsPanelTab', () => {
  beforeEach(() => {
    useArtifactStore.getState().clearArtifacts();
  });

  it('renders loading state', () => {
    render(<ArtifactsPanelTab loading artifacts={[]} />);

    expect(screen.getByText('Loading artifacts')).toBeInTheDocument();
  });

  it('renders empty state from explicit props', () => {
    render(<ArtifactsPanelTab artifacts={[]} />);

    expect(screen.getByText('No artifacts yet')).toBeInTheDocument();
  });

  it('renders artifact cards from explicit props', () => {
    render(
      <ArtifactsPanelTab
        artifacts={[
          {
            artifactId: 'artifact:1',
            title: 'Implementation plan',
            kind: 'implementation_plan',
            status: 'active',
            textPreview: 'Plan preview',
            currentVersionId: 'artifact-version:1',
          },
        ]}
      />,
    );

    expect(screen.getByText('Implementation plan')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders artifacts from artifact state when props are not provided', () => {
    useArtifactStore.getState().setArtifacts([
      {
        artifactId: 'artifact:store',
        title: 'Stored report',
        kind: 'report',
        status: 'active',
        textPreview: 'Store preview',
        currentVersionId: 'artifact-version:store',
      },
    ]);

    render(<ArtifactsPanelTab />);

    expect(screen.getByText('Stored report')).toBeInTheDocument();
  });
});
