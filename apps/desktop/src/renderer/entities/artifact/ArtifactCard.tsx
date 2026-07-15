import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Panel } from '../../shared/ui';
import type { ArtifactCardData } from './types';

interface ArtifactCardProps {
  artifact: ArtifactCardData;
}

const statusVariants = {
  draft: 'neutral',
  active: 'success',
  superseded: 'warning',
  archived: 'neutral',
  failed: 'danger',
  deleted: 'neutral',
} as const;

export function ArtifactCard({ artifact }: ArtifactCardProps) {
  const { t } = useTranslation('chat');
  return (
    <Panel className="p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <FileText size={16} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{artifact.title}</h3>
            <Badge variant={statusVariants[artifact.status]}>{t(`artifacts.statuses.${artifact.status}`)}</Badge>
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{artifact.kind}</p>
          {artifact.textPreview ? (
            <p className="mt-2 line-clamp-2 rounded-md bg-[var(--color-surface-muted)] px-2 py-1 text-xs text-[var(--color-text-muted)]">
              {artifact.textPreview}
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
