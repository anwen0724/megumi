/*
 * Provides the Desktop management surface for discovered Skills through the
 * Product Host. It never scans Skill files or derives Skill identity itself.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Box, FileText, FolderOpen, LoaderCircle, RefreshCw, TerminalSquare } from 'lucide-react';
import type { SkillDetailUiDto, SkillListUiItem } from '@megumi/product/host-interface';
import { useProjectStore } from '../../entities/project';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc';
import { Button, SettingsPageHeader, SettingsSection, cx } from '../../shared/ui';

type LoadStatus = 'loading' | 'ready' | 'failed';

export function SkillSettingsPanel() {
  const { t } = useTranslation('settings');
  const workspaceId = useProjectStore((state) => state.currentProjectId);
  const [skills, setSkills] = useState<SkillListUiItem[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<string>();
  const [pendingPath, setPendingPath] = useState<string>();
  const [selectedPath, setSelectedPath] = useState<string>();
  const [detail, setDetail] = useState<SkillDetailUiDto>();

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
    setSelectedPath(undefined);
    setDetail(undefined);
    void loadSkills();
  }, [workspaceId]);

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
    setSelectedPath(skill.skillPath);
    setDetail(undefined);
    if (!api?.get) return;
    const result = await api.get(createRendererRuntimeIpcRequest(
      IPC_CHANNELS.skill.get,
      { skillPath: skill.skillPath, ...(workspaceId ? { workspaceId } : {}) },
    ));
    if (result.ok && result.data.status === 'ok') {
      setDetail(result.data.skill);
    }
  }

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const skill of skills) counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  }, [skills]);

  return (
    <div className="space-y-6">
      <SettingsPageHeader title={t('categories.skills.label')} description={t('categories.skills.description')} />
      <SettingsSection>
        <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">{t('skills.discovered')}</h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('skills.discoveredDescription')}</p>
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
          <div role="alert" className="m-5 flex items-start gap-2 rounded-lg border border-[var(--color-danger)]/25 bg-[var(--color-danger)]/5 p-3 text-sm text-[var(--color-danger)]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{error}
          </div>
        ) : null}

        {status === 'ready' && skills.length === 0 ? (
          <div className="grid min-h-44 place-items-center px-6 text-center">
            <div>
              <Box size={24} className="mx-auto text-[var(--color-text-subtle)]" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-[var(--color-text)]">{t('skills.empty')}</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('skills.emptyDescription')}</p>
            </div>
          </div>
        ) : null}

        {status === 'ready' && skills.length > 0 ? (
          <div className="divide-y divide-[var(--color-border)]">
            {skills.map((skill) => {
              const displayName = formatSkillName(skill.name);
              const selected = selectedPath === skill.skillPath;
              return (
                <div key={skill.skillPath} className={cx('px-5 py-4 transition-colors', selected && 'bg-[var(--color-accent-soft)]/35')}>
                  <div className="flex items-start gap-4">
                    <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                      <Box size={16} aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => void showDetail(skill)} aria-label={t('skills.viewDetails', { name: displayName })} className="block max-w-full cursor-pointer text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-[var(--color-text)]">{displayName}</span>
                          <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[0.66rem] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">{skill.sourceLabel}</span>
                        </span>
                        <span className="mt-1 block text-sm leading-5 text-[var(--color-text-muted)]">{skill.description}</span>
                        {duplicateNames.has(skill.name) ? <span className="mt-1 block truncate font-mono text-[0.68rem] text-[var(--color-text-subtle)]">{shortPath(skill.skillPath)}</span> : null}
                      </button>
                      <div className="mt-2 flex min-h-5 items-center gap-3 text-xs text-[var(--color-text-subtle)]">
                        {skill.hasResources ? <span className="inline-flex items-center gap-1"><FolderOpen size={12} aria-hidden="true" />{t('skills.resources')}</span> : null}
                        {skill.hasScripts ? <span className="inline-flex items-center gap-1"><TerminalSquare size={12} aria-hidden="true" />{t('skills.scripts')}</span> : null}
                        {skill.diagnostics.length > 0 ? <span className="inline-flex items-center gap-1 text-[var(--color-warning)]"><AlertTriangle size={12} aria-hidden="true" />{t('skills.issues', { count: skill.diagnostics.length })}</span> : null}
                      </div>
                    </div>
                    <Button variant={skill.available ? 'secondary' : 'primary'} size="sm" disabled={pendingPath === skill.skillPath} onClick={() => void setAvailability(skill)} aria-label={skill.available ? t('skills.disableNamed', { name: displayName }) : t('skills.enableNamed', { name: displayName })}>
                      {pendingPath === skill.skillPath ? t('skills.saving') : skill.available ? t('skills.disable') : t('skills.enable')}
                    </Button>
                  </div>

                  {selected ? <SkillDetail detail={detail} /> : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </SettingsSection>
    </div>
  );
}

function SkillDetail({ detail }: { detail?: SkillDetailUiDto }) {
  const { t } = useTranslation('settings');
  if (!detail) return <p className="ml-13 mt-3 text-xs text-[var(--color-text-subtle)]">{t('skills.loadingDetail')}</p>;
  return (
    <div className="ml-13 mt-4 space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start gap-2">
        <FileText size={14} className="mt-0.5 shrink-0 text-[var(--color-text-subtle)]" aria-hidden="true" />
        <code className="break-all text-xs text-[var(--color-text-muted)]">{detail.skillPath}</code>
      </div>
      {detail.diagnostics.map((diagnostic, index) => (
        <p key={`${diagnostic.level}:${index}`} className="text-xs text-[var(--color-warning)]">{diagnostic.message}</p>
      ))}
      {(detail.resourcePaths.length > 0 || detail.scriptNames.length > 0) ? (
        <p className="text-xs text-[var(--color-text-muted)]">
          {t('skills.detailSummary', { resources: detail.resourcePaths.length, scripts: detail.scriptNames.length })}
        </p>
      ) : null}
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
