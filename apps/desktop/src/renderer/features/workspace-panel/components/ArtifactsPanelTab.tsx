import { ArtifactCard, type ArtifactCardData, useArtifactStore } from '../../../entities/artifact';

interface ArtifactsPanelTabProps {
  artifacts?: ArtifactCardData[];
  loading?: boolean;
}

export function ArtifactsPanelTab({ artifacts, loading = false }: ArtifactsPanelTabProps) {
  const storedArtifacts = useArtifactStore((state) => state.artifacts);
  const visibleArtifacts = artifacts ?? storedArtifacts;

  if (loading) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading artifacts</p>;
  }

  if (visibleArtifacts.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">No artifacts yet</p>;
  }

  return (
    <div className="space-y-3">
      {visibleArtifacts.map((artifact) => (
        <ArtifactCard key={artifact.artifactId} artifact={artifact} />
      ))}
    </div>
  );
}
