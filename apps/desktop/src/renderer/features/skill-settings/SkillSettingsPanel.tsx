/*
 * Provides the Desktop management surface for discovered Skills through the
 * Product Host. It never scans Skill files or derives Skill identity itself.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Box,
  FileText,
  FolderOpen,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  TerminalSquare,
  Trash2,
  X,
} from 'lucide-react';
import type { SkillDetailUiDto, SkillListUiItem } from '@megumi/product/host-interface';
import { useProjectStore } from '../../entities/project';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc';
import { Button, SettingsPageHeader, cx } from '../../shared/ui';

type LoadStatus = 'loading' | 'ready' | 'failed';
type SourceFilter = 'all' | 'System' | 'User';

export function SkillSettingsPanel() {
  const { t } = useTranslation('settings');
  const workspaceId = useProjectStore((state) => state.currentProjectId);
  const [skills, setSkills] = useState<SkillListUiItem[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<string>();
  const [pendingPath, setPendingPath] = useState<string>();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [menuPath, setMenuPath] = useState<string>();
  const [selectedPath, setSelectedPath] = useState<string>();
  const [detail, setDetail] = useState<SkillDetailUiDto>();
  const [detailError, setDetailError] = useState<string>();
  const [deleteCandidatePath, setDeleteCandidatePath] = useState<string>();

  async function loadSkills() {
    const api = window.megumi?.skill;
    if (!api?.list) {
      setError(t('skills.unavailable'));
      setStatus('failed');
      return;
    }
    setStatus('loading');
    setError(undefined);
    const result = await api.list(createRendererRuntimeIpcRequest(
      IPC_CHANNELS.skill.list,
      { ...(workspaceId ? { workspaceId } : {}) },
    ));
    if (result.ok && result.data.status === 'ok') {
      setSkills(result.data.skills);
      setStatus('ready');
      return;
    }
    if (!result.ok) setError(result.data.message);
    else if (result.data.status === 'failed') setError(result.data.failure.message);
    setStatus('failed');
  }

  useEffect(() => {
    setMenuPath(undefined);
    setSelectedPath(undefined);
    setDetail(undefined);
    setDetailError(undefined);
    setDeleteCandidatePath(undefined);
    void loadSkills();
  }, [workspaceId]);

  useEffect(() => {
    if (!menuPath && !selectedPath && !deleteCandidatePath) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (deleteCandidatePath) setDeleteCandidatePath(undefined);
      else if (selectedPath) closeDetail();
      else setMenuPath(undefined);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [deleteCandidatePath, menuPath, selectedPath]);

  async function setAvailability(skill: SkillListUiItem) {
    const api = window.megumi?.skill;
    if (!api?.disable || !api.enable) {
      setError(t('skills.unavailable'));
      return;
    }
    setPendingPath(skill.skillPath);
    setError(undefined);
    const payload = { skillPath: skill.skillPath, ...(workspaceId ? { workspaceId } : {}) };
    const result = skill.available
      ? await api.disable(createRendererRuntimeIpcRequest(IPC_CHANNELS.skill.disable, payload))
      : await api.enable(createRendererRuntimeIpcRequest(IPC_CHANNELS.skill.enable, payload));
    if (result.ok && result.data.status === 'ok') {
      setSkills((current) => current.map((item) => item.skillPath === skill.skillPath
        ? { ...item, available: !skill.available }
        : item));
      setDetail((current) => current?.skillPath === skill.skillPath
        ? { ...current, available: !skill.available }
        : current);
    } else {
      setError(result.ok && result.data.status === 'failed'
        ? result.data.failure.message
        : result.ok
          ? t('skills.notFound')
          : result.data.message);
    }
    setPendingPath(undefined);
  }

  async function showDetail(skill: SkillListUiItem) {
    const api = window.megumi?.skill;
    setMenuPath(undefined);
    setSelectedPath(skill.skillPath);
    setDetail(undefined);
    setDetailError(undefined);
    if (!api?.get) {
      setDetailError(t('skills.unavailable'));
      return;
    }
    const result = await api.get(createRendererRuntimeIpcRequest(
      IPC_CHANNELS.skill.get,
      { skillPath: skill.skillPath, ...(workspaceId ? { workspaceId } : {}) },
    ));
    if (result.ok && result.data.status === 'ok') {
      setDetail(result.data.skill);
      return;
    }
    setDetailError(result.ok && result.data.status === 'failed'
      ? result.data.failure.message
      : result.ok
        ? t('skills.notFound')
        : result.data.message);
  }

  async function deleteSkill(skill: SkillListUiItem) {
    const api = window.megumi?.skill;
    if (!api?.delete) {
      setError(t('skills.unavailable'));
      return;
    }
    setPendingPath(skill.skillPath);
    setError(undefined);
    const result = await api.delete(createRendererRuntimeIpcRequest(
      IPC_CHANNELS.skill.delete,
      { skillPath: skill.skillPath, ...(workspaceId ? { workspaceId } : {}) },
    ));
    if (result.ok && result.data.status === 'ok') {
      setSkills((current) => current.filter((item) => item.skillPath !== skill.skillPath));
      setDeleteCandidatePath(undefined);
    } else {
      setError(result.ok && result.data.status === 'failed'
        ? result.data.failure.message
        : result.ok && result.data.status === 'not_allowed'
          ? t('skills.deleteNotAllowed')
          : result.ok
            ? t('skills.notFound')
            : result.data.message);
      setDeleteCandidatePath(undefined);
    }
    setPendingPath(undefined);
  }

  function closeDetail() {
    setSelectedPath(undefined);
    setDetail(undefined);
    setDetailError(undefined);
  }

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const skill of skills) counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  }, [skills]);
  const visibleSkills = useMemo(() => sourceFilter === 'all'
    ? skills
    : skills.filter((skill) => skill.sourceLabel === sourceFilter), [skills, sourceFilter]);
  const selectedSkill = selectedPath ? skills.find((skill) => skill.skillPath === selectedPath) : undefined;
  const deleteCandidate = deleteCandidatePath
    ? skills.find((skill) => skill.skillPath === deleteCandidatePath)
    : undefined;

  return (
    <div className="space-y-7">
      <SettingsPageHeader title={t('categories.skills.label')} description={t('categories.skills.description')} />

      <section aria-label={t('skills.listLabel')}>
        <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] px-1 pb-3">
          <div role="tablist" aria-label={t('skills.filterLabel')} className="inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-0.5">
            {(['all', 'System', 'User'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                role="tab"
                aria-selected={sourceFilter === filter}
                onClick={() => setSourceFilter(filter)}
                className={cx(
                  'min-w-16 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]',
                  sourceFilter === filter
                    ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
                )}
              >
                {filter === 'all'
                  ? t('skills.filters.all')
                  : filter === 'System'
                    ? t('skills.filters.system')
                    : t('skills.filters.user')}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => void loadSkills()} disabled={status === 'loading'}>
            <RefreshCw size={14} aria-hidden="true" className={status === 'loading' ? 'animate-spin' : undefined} />
            {t('skills.refresh')}
          </Button>
        </div>

        {status === 'loading' ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]">
            <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />{t('skills.loading')}
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="my-4 flex items-start gap-2 rounded-lg border border-[var(--color-danger)]/25 bg-[var(--color-danger)]/5 p-3 text-sm text-[var(--color-danger)]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{error}
          </div>
        ) : null}

        {status === 'ready' && skills.length === 0 ? (
          <EmptySkills title={t('skills.empty')} description={t('skills.emptyDescription')} />
        ) : null}

        {status === 'ready' && skills.length > 0 && visibleSkills.length === 0 ? (
          <EmptySkills title={t('skills.noMatches')} description={t('skills.noMatchesDescription')} />
        ) : null}

        {status === 'ready' && visibleSkills.length > 0 ? (
          <div className="mt-2 space-y-1">
            {visibleSkills.map((skill) => {
              const displayName = formatSkillName(skill.name);
              const menuOpen = menuPath === skill.skillPath;
              return (
                <div
                  key={skill.skillPath}
                  className="group relative grid min-h-17 grid-cols-[auto_minmax(0,1fr)_8rem] items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-[var(--color-surface-muted)]"
                >
                  <div className={cx('grid h-10 w-10 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] shadow-sm', !skill.available && 'opacity-55')}>
                    <Box size={16} aria-hidden="true" />
                  </div>
                  <div className={cx('min-w-0', !skill.available && 'opacity-55')}>
                    <div className="flex min-w-0 items-center gap-2">
                      <h2 className="truncate text-sm font-medium text-[var(--color-text)]">{displayName}</h2>
                      {skill.hasResources ? <FolderOpen size={12} className="shrink-0 text-[var(--color-text-subtle)]" aria-label={t('skills.resources')} /> : null}
                      {skill.hasScripts ? <TerminalSquare size={12} className="shrink-0 text-[var(--color-text-subtle)]" aria-label={t('skills.scripts')} /> : null}
                      {skill.diagnostics.length > 0 ? <AlertTriangle size={12} className="shrink-0 text-[var(--color-warning)]" aria-label={t('skills.issues', { count: skill.diagnostics.length })} /> : null}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-[var(--color-text-muted)]">{skill.description}</p>
                    {duplicateNames.has(skill.name) ? <p className="mt-0.5 truncate font-mono text-[0.68rem] text-[var(--color-text-subtle)]">{shortPath(skill.skillPath)}</p> : null}
                  </div>
                  <div className="grid grid-cols-[3.5rem_2rem_2.25rem] items-center gap-1">
                    <span className={cx('text-right text-xs text-[var(--color-text-subtle)]', !skill.available && 'opacity-55')}>
                      {skill.sourceLabel === 'System' ? t('skills.sources.system') : t('skills.sources.user')}
                    </span>
                    <div className="relative">
                    <button
                      type="button"
                      aria-label={t('skills.moreActions', { name: displayName })}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      onClick={() => setMenuPath(menuOpen ? undefined : skill.skillPath)}
                      className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-text-subtle)] transition-colors hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
                    >
                      <MoreHorizontal size={17} aria-hidden="true" />
                    </button>
                    {menuOpen ? (
                      <>
                        <button type="button" aria-label={t('skills.closeMenu')} onClick={() => setMenuPath(undefined)} className="fixed inset-0 z-10 cursor-default" />
                        <div role="menu" className="absolute right-0 top-9 z-20 min-w-32 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-1 shadow-xl">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => void showDetail(skill)}
                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-accent-soft)] focus-visible:outline-none focus-visible:bg-[var(--color-accent-soft)]"
                          >
                            <FileText size={14} aria-hidden="true" />{t('skills.details')}
                          </button>
                          {skill.sourceLabel === 'User' ? (
                            <>
                              <div className="my-1 border-t border-[var(--color-border)]" />
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setMenuPath(undefined);
                                  setDeleteCandidatePath(skill.skillPath);
                                }}
                                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/10 focus-visible:outline-none focus-visible:bg-[var(--color-danger)]/10"
                              >
                                <Trash2 size={14} aria-hidden="true" />{t('skills.delete')}
                              </button>
                            </>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                    </div>
                    <AvailabilitySwitch
                      checked={skill.available}
                      disabled={pendingPath === skill.skillPath}
                      label={skill.available ? t('skills.disableNamed', { name: displayName }) : t('skills.enableNamed', { name: displayName })}
                      onClick={() => void setAvailability(skill)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      {selectedSkill ? (
        <SkillDetailDialog
          skill={selectedSkill}
          detail={detail}
          error={detailError}
          onClose={closeDetail}
        />
      ) : null}

      {deleteCandidate ? (
        <DeleteSkillDialog
          skill={deleteCandidate}
          deleting={pendingPath === deleteCandidate.skillPath}
          onCancel={() => setDeleteCandidatePath(undefined)}
          onConfirm={() => void deleteSkill(deleteCandidate)}
        />
      ) : null}
    </div>
  );
}

function DeleteSkillDialog({ skill, deleting, onCancel, onConfirm }: {
  skill: SkillListUiItem;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('settings');
  const displayName = formatSkillName(skill.name);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-6 backdrop-blur-[2px]"
      onMouseDown={(event) => { if (!deleting && event.target === event.currentTarget) onCancel(); }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-skill-title"
        aria-describedby="delete-skill-description"
        className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)]">
            <Trash2 size={17} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 id="delete-skill-title" className="text-base font-semibold text-[var(--color-text)]">
              {t('skills.deleteTitle', { name: displayName })}
            </h2>
            <p id="delete-skill-description" className="mt-1 text-sm leading-5 text-[var(--color-text-muted)]">
              {t('skills.deleteDescription')}
            </p>
          </div>
        </div>
        <code className="mt-4 block break-all rounded-lg bg-[var(--color-surface)] p-3 text-xs text-[var(--color-text-muted)]">
          {skill.skillPath}
        </code>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={deleting}>{t('skills.cancelDelete')}</Button>
          <Button variant="danger" onClick={onConfirm} disabled={deleting}>
            {deleting ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
            {deleting ? t('skills.deleting') : t('skills.confirmDelete')}
          </Button>
        </div>
      </section>
    </div>
  );
}

function AvailabilitySwitch({ checked, disabled, label, onClick }: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'relative h-5 w-9 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-app-bg)] disabled:cursor-wait disabled:opacity-60',
        checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-strong)]',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  );
}

function SkillDetailDialog({ skill, detail, error, onClose }: {
  skill: SkillListUiItem;
  detail?: SkillDetailUiDto;
  error?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('settings');
  const displayName = formatSkillName(skill.name);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-6 backdrop-blur-[2px]"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('skills.detailsTitle', { name: displayName })}
        className="flex max-h-[calc(100vh-3rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]">
            <Box size={16} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold text-[var(--color-text)]">{displayName}</h2>
              <span className="text-xs text-[var(--color-text-subtle)]">{skill.sourceLabel}</span>
            </div>
            <p className="mt-1 text-sm leading-5 text-[var(--color-text-muted)]">{skill.description}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('skills.closeDetails')} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]">
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-32 overflow-y-auto px-5 py-5">
          {error ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-[var(--color-danger)]/25 bg-[var(--color-danger)]/5 p-3 text-sm text-[var(--color-danger)]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{error}
            </div>
          ) : null}
          {!detail && !error ? (
            <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]">
              <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />{t('skills.loadingDetail')}
            </div>
          ) : null}
          {detail ? (
            <div className="space-y-5">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">{t('skills.location')}</h3>
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                  <FileText size={14} className="mt-0.5 shrink-0 text-[var(--color-text-subtle)]" aria-hidden="true" />
                  <code className="break-all text-xs text-[var(--color-text-muted)]">{detail.skillPath}</code>
                </div>
              </div>
              {(detail.resourcePaths.length > 0 || detail.scriptNames.length > 0) ? (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">{t('skills.contents')}</h3>
                  <p className="mt-2 text-sm text-[var(--color-text-muted)]">{t('skills.detailSummary', { resources: detail.resourcePaths.length, scripts: detail.scriptNames.length })}</p>
                </div>
              ) : null}
              {detail.content ? (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">{t('skills.instructions')}</h3>
                  <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 font-mono text-xs leading-5 text-[var(--color-text-muted)]">{detail.content}</div>
                </div>
              ) : null}
              {detail.diagnostics.length > 0 ? (
                <div className="space-y-2">
                  {detail.diagnostics.map((diagnostic, index) => (
                    <p key={`${diagnostic.level}:${index}`} className="flex items-start gap-2 text-xs text-[var(--color-warning)]"><AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />{diagnostic.message}</p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function EmptySkills({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-44 place-items-center px-6 text-center">
      <div>
        <Box size={24} className="mx-auto text-[var(--color-text-subtle)]" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-[var(--color-text)]">{title}</p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{description}</p>
      </div>
    </div>
  );
}

function formatSkillName(name: string): string {
  return name.split(/[-_\s]+/).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join(' ');
}

function shortPath(skillPath: string): string {
  const parts = skillPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-3).join('/');
}
