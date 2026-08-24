/*
 * Presents interest management and daily discovery settings as two focused
 * views while keeping persistence behind the renderer-safe Host contract.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Check, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DiscoveryConfigurationUiDto, DiscoveryHomeUiResult } from '@megumi/product-host/host';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import { Button, cx } from '../../../shared/ui';

interface InterestManagerProps {
  open: boolean;
  interests: DiscoveryHomeUiResult['interests'];
  onClose(): void;
  onChanged(): Promise<void>;
}

type ManagerView = 'interests' | 'settings';
type DiscoverySettings = DiscoveryConfigurationUiDto;
const EXIT_SETTLE_MS = 260;

export function InterestManager({ open, interests, onClose, onChanged }: InterestManagerProps) {
  const { t } = useTranslation('discovery');
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(false);
  const [view, setView] = useState<ManagerView>('interests');
  const [newInterest, setNewInterest] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editingInterestId, setEditingInterestId] = useState<string | null>(null);
  const [menuInterestId, setMenuInterestId] = useState<string | null>(null);
  const [settings, setSettings] = useState<DiscoverySettings | null>(null);
  const [persistedSettings, setPersistedSettings] = useState<DiscoverySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setRendered(true);
      setView('interests');
      setEditingInterestId(null);
      setMenuInterestId(null);
      setError(null);
      const enterTimer = window.setTimeout(() => {
        setVisible(true);
        closeButtonRef.current?.focus();
      }, 0);
      return () => window.clearTimeout(enterTimer);
    }

    setVisible(false);
    const exitTimer = window.setTimeout(() => {
      setRendered(false);
      previousFocusRef.current?.focus();
    }, prefersReducedMotion() ? 0 : EXIT_SETTLE_MS);
    return () => window.clearTimeout(exitTimer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setDrafts(Object.fromEntries(interests.map((interest) => [interest.interestId, interest.description])));
  }, [open, interests]);

  useEffect(() => {
    if (!open) return;
    setSaved(false);
    void loadSettings();
  }, [open]);

  useEffect(() => {
    if (!open || view !== 'settings') return;
    const timer = window.setInterval(() => void refreshSourceAvailability(), 15_000);
    return () => window.clearInterval(timer);
  }, [open, view]);

  const settingsDirty = useMemo(() => (
    settings !== null
    && persistedSettings !== null
    && JSON.stringify(settings) !== JSON.stringify(persistedSettings)
  ), [persistedSettings, settings]);

  async function loadSettings() {
    try {
      const result = await window.megumi.discovery.getConfiguration(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.discovery.configurationGet, {}),
      );
      if (result.ok) {
        setSettings(result.data);
        setPersistedSettings(result.data);
      } else {
        setError(t('loadFailed'));
      }
    } catch {
      setError(t('loadFailed'));
    }
  }

  async function changeInterest(payload: Parameters<typeof window.megumi.discovery.changeInterest>[0]['payload']) {
    setBusy(true);
    setError(null);
    try {
      const result = await window.megumi.discovery.changeInterest(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.discovery.interestChange, payload),
      );
      if (!result.ok) {
        setError(t('actionFailed'));
        return false;
      }
      await onChanged();
      return true;
    } catch {
      setError(t('actionFailed'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addInterest(event: FormEvent) {
    event.preventDefault();
    const description = newInterest.trim();
    if (!description) return;
    if (await changeInterest({ action: 'create', description })) setNewInterest('');
  }

  async function saveInterest(interestId: string) {
    const description = drafts[interestId]?.trim();
    if (!description) return;
    if (await changeInterest({ action: 'update', interestId, description })) {
      setEditingInterestId(null);
    }
  }

  async function saveSettings() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await window.megumi.discovery.updateConfiguration(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.discovery.configurationUpdate,
        {
          conversationRecognitionEnabled: settings.conversationRecognitionEnabled,
          dailyGenerationTime: settings.dailyGenerationTime,
          dailyTargetCount: settings.dailyTargetCount,
          enabledSources: settings.sources.filter((source) => source.enabled).map((source) => source.sourceId),
        },
      ));
      if (!result.ok) {
        setError(t('actionFailed'));
        return;
      }
      const savedSettings = result.data;
      setSettings(savedSettings);
      setPersistedSettings(savedSettings);
      setSaved(true);
    } catch {
      setError(t('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function refreshSourceAvailability() {
    const result = await window.megumi.discovery.getConfiguration(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.discovery.configurationGet, {}),
    );
    if (!result.ok) return;
    const availability = new Map(result.data.sources.map((source) => [source.sourceId, source]));
    const mergeAvailability = (current: DiscoverySettings | null) => current ? ({
      ...current,
      sources: current.sources.map((source) => {
        const latest = availability.get(source.sourceId);
        return latest ? { ...source, connectionState: latest.connectionState, checkedAt: latest.checkedAt, retryAt: latest.retryAt } : source;
      }),
    }) : current;
    setSettings(mergeAvailability);
    setPersistedSettings(mergeAvailability);
  }

  function updateSettings(update: (current: DiscoverySettings) => DiscoverySettings) {
    setSaved(false);
    setSettings((current) => current ? update(current) : current);
  }

  function cancelEditing(interestId: string, description: string) {
    setDrafts((current) => ({ ...current, [interestId]: description }));
    setEditingInterestId(null);
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;

    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!rendered) return null;

  const settingsValid = Boolean(
    settings
    && settings.sources.some((source) => source.enabled)
    && settings.dailyTargetCount >= 1
    && settings.dailyTargetCount <= 100,
  );

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cx(
        'fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[2px] transition-opacity motion-reduce:transition-none',
        visible
          ? 'opacity-100 duration-200 ease-out'
          : 'pointer-events-none opacity-0 duration-200 ease-in',
      )}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="interest-manager-title"
        onKeyDown={handleDialogKeyDown}
        className={cx(
          'flex h-full w-full max-w-[34rem] flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-app-bg)] shadow-[var(--shadow-soft)] transition-transform motion-reduce:transition-none',
          visible
            ? 'translate-x-0 duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]'
            : 'translate-x-full duration-[240ms] ease-in',
        )}
      >
        <header className="border-b border-[var(--color-border)] bg-[var(--color-app-bg)]/95 px-6 pb-4 pt-5 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="interest-manager-title" className="text-xl font-semibold tracking-[-0.025em] text-[var(--color-text)]">{t('managementTitle')}</h2>
              <p className="mt-1 max-w-md text-sm leading-5 text-[var(--color-text-muted)]">{t('managementDescription')}</p>
              <p className="mt-2 text-xs font-medium text-[var(--color-text-subtle)]">
                {t('managementSummary', { count: interests.length, time: settings?.dailyGenerationTime ?? '—' })}
              </p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              aria-label={t('close')}
              onClick={onClose}
              className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div role="tablist" aria-label={t('managementTitle')} className="mt-5 grid grid-cols-2 rounded-xl bg-[var(--color-surface-muted)] p-1">
            <ManagerTab active={view === 'interests'} controls="interest-manager-interests" onClick={() => setView('interests')}>
              {t('interestsTab', { count: interests.length })}
            </ManagerTab>
            <ManagerTab active={view === 'settings'} controls="interest-manager-settings" onClick={() => setView('settings')}>
              {t('settingsTab')}
            </ManagerTab>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {view === 'interests' ? (
            <section id="interest-manager-interests" role="tabpanel" className="animate-[megumi-panel-in_180ms_ease-out] space-y-5 p-6 motion-reduce:animate-none">
              <form onSubmit={(event) => void addInterest(event)} className="flex gap-2">
                <label className="sr-only" htmlFor="new-discovery-interest">{t('addInterestLabel')}</label>
                <input
                  id="new-discovery-interest"
                  aria-label={t('addInterestLabel')}
                  value={newInterest}
                  disabled={busy}
                  onChange={(event) => setNewInterest(event.target.value)}
                  placeholder={t('addInterestPlaceholder')}
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm text-[var(--color-text)] outline-none transition-shadow placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20"
                />
                <Button type="submit" variant="primary" className="min-h-11 rounded-xl" disabled={busy || !newInterest.trim()}>
                  <Plus size={15} aria-hidden="true" />{t('add')}
                </Button>
              </form>

              <div className="space-y-3">
                {interests.map((interest) => {
                  const editing = editingInterestId === interest.interestId;
                  const menuOpen = menuInterestId === interest.interestId;
                  return (
                    <article key={interest.interestId} className="relative rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4 shadow-sm transition-shadow hover:shadow-[var(--shadow-soft)]">
                      {editing ? (
                        <div className="animate-[megumi-panel-in_150ms_ease-out] motion-reduce:animate-none">
                          <label className="sr-only" htmlFor={`interest-editor-${interest.interestId}`}>
                            {t('editInterest', { description: interest.description })}
                          </label>
                          <textarea
                            id={`interest-editor-${interest.interestId}`}
                            autoFocus
                            rows={3}
                            value={drafts[interest.interestId] ?? interest.description}
                            disabled={busy}
                            onChange={(event) => setDrafts((current) => ({ ...current, [interest.interestId]: event.target.value }))}
                            className="w-full resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-app-bg)] px-3 py-2.5 text-sm leading-6 text-[var(--color-text)] outline-none focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20"
                          />
                          <div className="mt-3 flex justify-end gap-2">
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => cancelEditing(interest.interestId, interest.description)}>{t('cancel')}</Button>
                            <Button size="sm" disabled={busy || !drafts[interest.interestId]?.trim()} onClick={() => void saveInterest(interest.interestId)}>{t('saveChanges')}</Button>
                          </div>
                        </div>
                      ) : (
                        <InterestSummary
                          description={interest.description}
                          origin={t(interest.createdFrom)}
                          status={t(interest.status)}
                          active={interest.status === 'active'}
                          busy={busy}
                          menuOpen={menuOpen}
                          moreActionsLabel={t('moreActions', { description: interest.description })}
                          editLabel={t('edit')}
                          deleteLabel={t('delete')}
                          stateLabel={t(interest.status === 'active' ? 'active' : 'paused')}
                          switchLabel={`${t(interest.status === 'active' ? 'pause' : 'resume')} ${interest.description}`}
                          onToggleMenu={() => setMenuInterestId(menuOpen ? null : interest.interestId)}
                          onEdit={() => {
                            setMenuInterestId(null);
                            setEditingInterestId(interest.interestId);
                          }}
                          onDelete={() => {
                            setMenuInterestId(null);
                            void changeInterest({ action: 'delete', interestId: interest.interestId });
                          }}
                          onToggleActive={() => void changeInterest({
                            action: interest.status === 'active' ? 'pause' : 'resume',
                            interestId: interest.interestId,
                          })}
                        />
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ) : (
          <SettingsPanel settings={settings} busy={busy} onUpdate={updateSettings} />
          )}

          {error ? <p role="alert" className={cx('mx-6 mb-6 rounded-xl px-4 py-3 text-sm', 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]')}>{error}</p> : null}
        </div>

        {view === 'settings' && settings ? (
          <footer className="flex min-h-20 items-center justify-between gap-4 border-t border-[var(--color-border)] bg-[var(--color-app-bg)]/95 px-6 py-4 backdrop-blur">
            <span aria-live="polite" className={cx('inline-flex items-center gap-1.5 text-xs transition-opacity', saved ? 'text-[var(--color-success)] opacity-100' : 'opacity-0')}>
              <Check size={14} aria-hidden="true" />{t('saved')}
            </span>
            <Button variant="primary" className="min-h-11 rounded-xl" disabled={busy || !settingsValid || !settingsDirty} onClick={() => void saveSettings()}>
              {t('saveSettings')}
            </Button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function InterestSummary(props: {
  description: string;
  origin: string;
  status: string;
  active: boolean;
  busy: boolean;
  menuOpen: boolean;
  moreActionsLabel: string;
  editLabel: string;
  deleteLabel: string;
  stateLabel: string;
  switchLabel: string;
  onToggleMenu(): void;
  onEdit(): void;
  onDelete(): void;
  onToggleActive(): void;
}) {
  return (
    <>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap text-sm font-medium leading-6 text-[var(--color-text)]">{props.description}</p>
          <div className="mt-2 flex items-center gap-2 text-[0.72rem] text-[var(--color-text-subtle)]">
            <span>{props.origin}</span><span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1.5">
              <span className={cx('h-1.5 w-1.5 rounded-full', props.active ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-subtle)]')} aria-hidden="true" />
              {props.status}
            </span>
          </div>
        </div>
        <div className="relative">
          <button
            type="button"
            aria-label={props.moreActionsLabel}
            aria-haspopup="menu"
            aria-expanded={props.menuOpen}
            disabled={props.busy}
            onClick={props.onToggleMenu}
            className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl text-[var(--color-text-subtle)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
          >
            <MoreHorizontal size={18} aria-hidden="true" />
          </button>
          {props.menuOpen ? (
            <div role="menu" className="absolute right-0 top-11 z-20 min-w-32 animate-[megumi-panel-in_120ms_ease-out] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-1.5 shadow-[var(--shadow-soft)] motion-reduce:animate-none">
              <button type="button" role="menuitem" onClick={props.onEdit} className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-muted)]">
                <Pencil size={14} aria-hidden="true" />{props.editLabel}
              </button>
              <button type="button" role="menuitem" onClick={props.onDelete} className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-soft)]">
                <Trash2 size={14} aria-hidden="true" />{props.deleteLabel}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-[var(--color-border)] pt-3">
        <span className="text-xs text-[var(--color-text-muted)]">{props.stateLabel}</span>
        <Switch checked={props.active} disabled={props.busy} label={props.switchLabel} onCheckedChange={props.onToggleActive} />
      </div>
    </>
  );
}

function SettingsPanel({ settings, busy, onUpdate }: {
  settings: DiscoverySettings | null;
  busy: boolean;
  onUpdate(update: (current: DiscoverySettings) => DiscoverySettings): void;
}) {
  const { t } = useTranslation('discovery');
  return (
    <section id="interest-manager-settings" role="tabpanel" className="animate-[megumi-panel-in_180ms_ease-out] p-6 motion-reduce:animate-none">
      <h3 className="text-base font-semibold text-[var(--color-text)]">{t('settingsTitle')}</h3>
      <p className="mt-1 text-sm leading-5 text-[var(--color-text-muted)]">{t('settingsDescription')}</p>
      {settings ? (
        <>
          <div className="mt-5 divide-y divide-[var(--color-border)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4">
            <SettingRow label={t('recognition')}>
              <Switch checked={settings.conversationRecognitionEnabled} disabled={busy} label={t('recognition')} onCheckedChange={(checked) => onUpdate((current) => ({ ...current, conversationRecognitionEnabled: checked }))} />
            </SettingRow>
            <SettingRow label={t('generationTime')} htmlFor="discovery-generation-time">
              <input id="discovery-generation-time" type="time" value={settings.dailyGenerationTime} disabled={busy} onChange={(event) => onUpdate((current) => ({ ...current, dailyGenerationTime: event.target.value }))} className="min-h-11 w-32 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20" />
            </SettingRow>
            <SettingRow label={t('targetCount')} htmlFor="discovery-target-count">
              <input id="discovery-target-count" aria-label={t('targetCount')} type="number" min={1} max={100} value={settings.dailyTargetCount} disabled={busy} onChange={(event) => onUpdate((current) => ({ ...current, dailyTargetCount: Number(event.target.value) }))} className="min-h-11 w-32 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20" />
            </SettingRow>
          </div>

          <fieldset className="mt-6">
            <legend className="text-sm font-semibold text-[var(--color-text)]">{t('sources')}</legend>
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">{t('sourcesDescription')}</p>
            <div className="mt-3 space-y-2">
              {settings.sources.map((source) => {
                const label = source.name;
                const checked = source.enabled;
                return (
                  <div key={source.sourceId} className="flex min-h-14 items-center justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
                    <span className="min-w-0 text-sm text-[var(--color-text)]">
                      <span className="block">{label}</span>
                      <span className="block text-xs text-[var(--color-text-muted)]">{t(sourceStateTranslationKey(source.connectionState))}</span>
                    </span>
                    <Switch checked={checked} disabled={busy} label={label} onCheckedChange={(nextChecked) => onUpdate((current) => ({
                      ...current,
                      sources: current.sources.map((item) => item.sourceId === source.sourceId
                        ? { ...item, enabled: nextChecked }
                        : item),
                    }))} />
                  </div>
                );
              })}
            </div>
          </fieldset>
        </>
      ) : <p className="mt-5 text-sm text-[var(--color-text-muted)]">{t('loading')}</p>}
    </section>
  );
}

function sourceStateTranslationKey(state: DiscoverySettings['sources'][number]['connectionState']) {
  return ({
    ready: 'sourceReady',
    unknown: 'sourceUnknown',
    login_required: 'sourceLoginRequired',
    rate_limited: 'sourceRateLimited',
    risk_controlled: 'sourceRiskControlled',
    not_configured: 'sourceNotConfigured',
  } as const)[state];
}

function ManagerTab({ active, controls, onClick, children }: { active: boolean; controls: string; onClick(): void; children: string }) {
  return (
    <button type="button" role="tab" aria-selected={active} aria-controls={controls} onClick={onClick} className={cx(
      'min-h-10 cursor-pointer rounded-lg px-3 text-sm font-medium transition-[background-color,color,box-shadow] duration-150',
      active ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
    )}>
      {children}
    </button>
  );
}

function SettingRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[4.5rem] items-center justify-between gap-4 py-3">
      {htmlFor ? <label htmlFor={htmlFor} className="text-sm text-[var(--color-text)]">{label}</label> : <span className="max-w-[18rem] text-sm leading-5 text-[var(--color-text)]">{label}</span>}
      {children}
    </div>
  );
}

function Switch({ checked, disabled, label, onCheckedChange }: { checked: boolean; disabled?: boolean; label: string; onCheckedChange(checked: boolean): void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} title={label} disabled={disabled} onClick={() => onCheckedChange(!checked)} className="inline-flex h-11 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50">
      <span aria-hidden="true" className={cx(
        'relative h-6 w-11 rounded-full border transition-[background-color,border-color] duration-150',
        checked ? 'border-[var(--color-accent)] bg-[var(--color-accent)]' : 'border-[var(--color-border-strong)] bg-[var(--color-surface-muted)]',
      )}>
        <span className={cx(
          'absolute left-0.5 top-0.5 h-[1.125rem] w-[1.125rem] rounded-full shadow-sm transition-[transform,background-color] duration-150 ease-out',
          checked ? 'translate-x-5 bg-[var(--color-accent-foreground)]' : 'translate-x-0 bg-[var(--color-text-subtle)]',
        )} />
      </span>
    </button>
  );
}
