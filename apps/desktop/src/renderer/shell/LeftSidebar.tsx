import {
  Activity,
  ChevronLeft,
  ClipboardList,
  Clock3,
  MessageSquarePlus,
  PanelLeftOpen,
  Settings,
} from 'lucide-react';
import { Badge, Button, IconButton, cx } from '../shared/ui';

export interface SidebarSessionItem {
  id: string;
  title: string;
  meta: string;
  active: boolean;
}

interface LeftSidebarProps {
  collapsed: boolean;
  workspaceName: string;
  workspacePath: string;
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
  workspacePath,
  sessions,
  loading = false,
  onToggleCollapsed,
  onCreateSession,
  onSelectSession,
  onOpenSettings,
}: LeftSidebarProps) {
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
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <Activity size={15} aria-hidden="true" />
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-muted)]">
            <ClipboardList size={15} aria-hidden="true" />
          </div>
          <div className="mt-auto">
            <IconButton label="Settings" onClick={onOpenSettings} size="sm" variant="ghost">
              <Settings size={15} aria-hidden="true" />
            </IconButton>
          </div>
        </nav>
      </aside>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-muted)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-[var(--color-text)]">{workspaceName}</p>
            <Badge variant="accent">Warm</Badge>
          </div>
          <p className="truncate text-xs text-[var(--color-text-muted)]">{workspacePath}</p>
        </div>
        <IconButton label="Collapse sidebar" onClick={onToggleCollapsed} size="sm" className="ml-3">
          <ChevronLeft size={16} aria-hidden="true" />
        </IconButton>
      </div>

      <nav aria-label="Primary workspace navigation" className="flex-1 overflow-y-auto px-3 py-3">
        <Button onClick={onCreateSession} variant="primary" size="sm" className="mb-3 w-full justify-start">
          <MessageSquarePlus size={15} aria-hidden="true" />
          New session
        </Button>

        <div className="mb-4 space-y-1">
          <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--color-text)]">
            <Activity size={15} aria-hidden="true" />
            Assistant activity
          </button>
          <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--color-text-muted)]">
            <ClipboardList size={15} aria-hidden="true" />
            Task plan
          </button>
        </div>

        <div>
          <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Sessions
          </p>
          {loading ? (
            <p className="px-3 py-2 text-sm text-[var(--color-text-muted)]">Loading sessions</p>
          ) : sessions.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <p className="text-sm font-medium text-[var(--color-text)]">No sessions yet</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">Start a local session for this workspace.</p>
              <Button onClick={onCreateSession} variant="secondary" size="sm" className="mt-3 w-full">
                <MessageSquarePlus size={14} aria-hidden="true" />
                Start a session
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => onSelectSession?.(session.id)}
                  aria-current={session.active ? 'page' : undefined}
                  className={cx(
                    'w-full rounded-md px-3 py-2 text-left transition',
                    session.active
                      ? 'bg-[var(--color-accent-soft)] text-[var(--color-text)]'
                      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]',
                  )}
                >
                  <span className="block truncate text-sm font-medium">{session.title}</span>
                  <span className="mt-0.5 flex items-center gap-1 truncate text-xs">
                    <Clock3 size={12} aria-hidden="true" />
                    {session.meta}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
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
