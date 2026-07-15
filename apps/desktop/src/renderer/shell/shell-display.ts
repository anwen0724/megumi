interface WorkspaceBasenameInput {
  workspaceName?: string | null;
  workspacePath?: string | null;
}

export function getWorkspaceBasename({ workspaceName, workspacePath }: WorkspaceBasenameInput): string {
  const trimmedPath = workspacePath?.trim();

  if (trimmedPath) {
    const normalizedPath = trimmedPath.replace(/[\\/]+$/, '');
    const segments = normalizedPath.split(/[\\/]+/).filter(Boolean);
    const lastSegment = segments.at(-1);

    if (lastSegment) {
      return lastSegment;
    }
  }

  const trimmedName = workspaceName?.trim();

  return trimmedName || rendererI18n.t('shell:workspace.localSessions');
}

export function formatSessionUpdatedAt(updatedAt: string, now = new Date()): string {
  const date = new Date(updatedAt);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) {
    return formatRelativeTime(0, 'minute');
  }

  if (minutes < 60) {
    return formatRelativeTime(-minutes, 'minute');
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return formatRelativeTime(-hours, 'hour');
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return formatRelativeTime(-days, 'day');
  }

  const weeks = Math.floor(days / 7);

  if (weeks < 5) {
    return formatRelativeTime(-weeks, 'week');
  }

  return formatDate(date, undefined, {
    month: 'short',
    day: 'numeric',
  }) ?? '';
}
import { formatDate, formatRelativeTime, rendererI18n } from '../shared/i18n';
