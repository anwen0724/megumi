import { FileText } from 'lucide-react';
import type { ArtifactType } from './types';
import { Badge, Panel } from '../../shared/ui';

export type ArtifactStatus = 'draft' | 'created' | 'modified' | 'failed';

export interface ArtifactCardData {
  id: string;
  title: string;
  type: ArtifactType;
  status: ArtifactStatus;
  filePath: string | null;
}

interface ArtifactCardProps {
  artifact: ArtifactCardData;
}

const statusLabels: Record<ArtifactStatus, string> = {
  draft: 'Draft',
  created: 'Created',
  modified: 'Modified',
  failed: 'Failed',
};

const statusVariants: Record<ArtifactStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral',
  created: 'success',
  modified: 'warning',
  failed: 'danger',
};

export function ArtifactCard({ artifact }: ArtifactCardProps) {
  return (
    <Panel className="p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <FileText size={16} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{artifact.title}</h3>
            <Badge variant={statusVariants[artifact.status]}>{statusLabels[artifact.status]}</Badge>
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{artifact.type}</p>
          {artifact.filePath ? (
            <p className="mt-2 truncate rounded-md bg-[var(--color-surface-muted)] px-2 py-1 text-xs text-[var(--color-text-muted)]">
              {artifact.filePath}
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
