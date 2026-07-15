import { ArtifactCard, type ArtifactCardData, useArtifactStore } from '../../../entities/artifact';
import { useTranslation } from 'react-i18next';

interface ArtifactsPanelTabProps {
  artifacts?: ArtifactCardData[];
  loading?: boolean;
}

export function ArtifactsPanelTab({ artifacts, loading = false }: ArtifactsPanelTabProps) {
  const { t } = useTranslation('chat');
  const storedArtifacts = useArtifactStore((state) => state.artifacts);
  const visibleArtifacts = artifacts ?? storedArtifacts;

  if (loading) {
    return <p className="text-sm text-[var(--color-text-muted)]">{t('workspace.loadingArtifacts')}</p>;
  }

  if (visibleArtifacts.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">{t('workspace.noArtifacts')}</p>;
  }

  return (
    <div className="space-y-3">
      {visibleArtifacts.map((artifact) => (
        <ArtifactCard key={artifact.artifactId} artifact={artifact} />
      ))}
    </div>
  );
}
