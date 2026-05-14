import { ArtifactCard, type ArtifactCardData } from '../../../entities/artifact';
import { useWorkspaceStateStore } from '../../../entities/workspace-state';

interface ArtifactsPanelTabProps {
  artifacts?: ArtifactCardData[];
  loading?: boolean;
}

export function ArtifactsPanelTab({ artifacts, loading = false }: ArtifactsPanelTabProps) {
  const storedArtifacts = useWorkspaceStateStore((state) => state.artifacts);
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
        <ArtifactCard key={artifact.id} artifact={artifact} />
      ))}
    </div>
  );
}
