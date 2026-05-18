import { useState } from 'react';
import { ChevronLeft, ClipboardList, MessageSquarePlus, PanelLeftOpen, Settings } from 'lucide-react';
import { Button, IconButton, cx } from '../shared/ui';

const VISIBLE_SESSION_COUNT = 5;

export interface SidebarSessionItem {
  id: string;
  title: string;
  meta: string;
  active: boolean;
}

interface LeftSidebarProps {
  collapsed: boolean;
  workspaceName: string;
  sessions: SidebarSessionItem[];
  loading?: boolean;
  onToggleCollapsed: () => void;
  onCreateSession: () => void;
  onSelectSession?: (id: string) => void;
  onOpenSettings?: () => void;
}

export function LeftSidebar({
  collapsed,
  workspaceName,
  sessions,
  loading = false,
  onToggleCollapsed,
  onCreateSession,
  onSelectSession,
  onOpenSettings,
}: LeftSidebarProps) {
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [workspaceSessionsOpen, setWorkspaceSessionsOpen] = useState(true);
  const workspaceSessionsLabel = workspaceName === 'Local sessions' ? 'Local sessions' : `${workspaceName} sessions`;

  if (collapsed) {
    return (
      <aside className="w-14 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface-muted)]">
        <nav aria-label="Primary workspace navigation" className="flex h-full flex-col items-center gap-3 py-3">
          <IconButton label="Expand sidebar" onClick={onToggleCollapsed} size="sm">
            <PanelLeftOpen size={16} aria-hidden="true" />
          </IconButton>
          <IconButton label="New session" onClick={onCreateSession} size="sm" variant="primary">
            <MessageSquarePlus size={15} aria-hidden="true" />
          </IconButton>
          <IconButton label="Task plan" size="sm" variant="ghost">
            <ClipboardList size={15} aria-hidden="true" />
          </IconButton>
          <div className="mt-auto">
            <IconButton label="Settings" onClick={onOpenSettings} size="sm" variant="ghost">
              <Settings size={15} aria-hidden="true" />
            </IconButton>
          </div>
        </nav>
      </aside>
    );
  }

  const visibleSessions = showAllSessions ? sessions : sessions.slice(0, VISIBLE_SESSION_COUNT);
  const canToggleSessionCount = sessions.length > VISIBLE_SESSION_COUNT;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-muted)]">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="truncate text-sm font-semibold text-[var(--color-text)]">Megumi</p>
        <IconButton label="Collapse sidebar" onClick={onToggleCollapsed} size="sm" className="ml-3">
          <ChevronLeft size={16} aria-hidden="true" />
        </IconButton>
      </div>

      <nav aria-label="Primary workspace navigation" className="flex-1 overflow-y-auto px-3 py-2">
        <Button onClick={onCreateSession} variant="primary" size="sm" className="mb-3 w-full justify-start">
          <MessageSquarePlus size={15} aria-hidden="true" />
          New session
        </Button>

        <button
          type="button"
          className="mb-5 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
        >
          <ClipboardList size={15} aria-hidden="true" />
          Task plan
        </button>

        <section aria-label="Workspace sessions">
          <button
            type="button"
            onClick={() => setWorkspaceSessionsOpen((value) => !value)}
            aria-expanded={workspaceSessionsOpen}
            className="mb-1 flex w-full items-center rounded-md px-3 py-1.5 text-left text-xs font-semibold text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
            aria-label={workspaceSessionsLabel}
          >
            <span className="truncate">{workspaceName}</span>
          </button>

          {workspaceSessionsOpen ? (
            <>
              {loading ? (
                <p className="px-6 py-2 text-sm text-[var(--color-text-muted)]">Loading sessions</p>
              ) : sessions.length === 0 ? (
                <p className="px-6 py-2 text-sm text-[var(--color-text-muted)]">No sessions yet</p>
              ) : (
                <div className="space-y-0.5">
                  {visibleSessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => onSelectSession?.(session.id)}
                      aria-current={session.active ? 'page' : undefined}
                      className={cx(
                        'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md py-1.5 pl-6 pr-3 text-left text-sm transition',
                        session.active
                          ? 'bg-[var(--color-accent-soft)] text-[var(--color-text)]'
                          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]',
                      )}
                    >
                      <span className="truncate font-medium">{session.title}</span>
                      <span className="text-xs text-[var(--color-text-muted)]">{session.meta}</span>
                    </button>
                  ))}
                </div>
              )}

              {canToggleSessionCount ? (
                <button
                  type="button"
                  onClick={() => setShowAllSessions((value) => !value)}
                  className="mt-1 rounded-md px-6 py-1.5 text-left text-sm text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
                >
                  {showAllSessions ? 'Show fewer sessions' : 'Show more sessions'}
                </button>
              ) : null}
            </>
          ) : null}
        </section>
      </nav>

      <div className="border-t border-[var(--color-border)] p-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
        >
          <Settings size={15} aria-hidden="true" />
          Settings
        </button>
      </div>
    </aside>
  );
}
