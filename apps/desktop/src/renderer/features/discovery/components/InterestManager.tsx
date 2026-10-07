/*
 * Presents interest management and the content-source list as two focused views
 * while keeping persistence behind the renderer-safe Host contract.
 */
import { useState, type FormEvent } from 'react';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  InterestUi,
  SupplySourceView,
} from '@megumi/application/contracts';
import { Button, cx } from '../../../shared/ui';
/** Local form intent; transport uses separate create, update and delete operations. */
export type InterestEdit =
  | {action:'create';description:string}
  | {action:'update';interestId:string;expectedRevision:number;description:string}
  | {action:'pause'|'resume'|'delete';interestId:string;expectedRevision:number};

interface InterestManagerProps {
  interests: InterestUi[] | null;
  sources: SupplySourceView[] | null;
  onChangeInterest(request: InterestEdit): Promise<boolean>;
  onChangeSources(enabledSources: SupplySourceView['sourceId'][]): Promise<boolean>;
  onOpenContentSources?(): void;
}

type ManagerView = 'interests' | 'settings';

export function InterestManager({
  interests,
  sources,
  onChangeInterest,
  onChangeSources,
  onOpenContentSources,
}: InterestManagerProps) {
  const { t } = useTranslation('discovery');
  const [view, setView] = useState<ManagerView>('interests');
  const [newInterest, setNewInterest] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editingInterestId, setEditingInterestId] = useState<string | null>(null);
  const [editingRevision, setEditingRevision] = useState<number>(0);
  const [menuInterestId, setMenuInterestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const savedInterests = interests ?? [];
  const count = savedInterests.length;

  async function change(request: InterestEdit): Promise<boolean> {
    setBusy(true);
    try {
      return await onChangeInterest(request);
    } finally {
      setBusy(false);
    }
  }

  async function addInterest(event: FormEvent) {
    event.preventDefault();
    const description = newInterest.trim();
    if (!description) return;
    if (await change({ action: 'create', description })) setNewInterest('');
  }

  async function saveInterest(interestId: string) {
    const description = drafts[interestId]?.trim();
    if (!description) return;
    if (await change({ action: 'update', interestId, expectedRevision: editingRevision, description })) {
      setEditingInterestId(null);
    }
  }

  async function changeSource(sourceId: string, enabled: boolean) {
    if (!sources) return;
    setBusy(true);
    try {
      await onChangeSources(
        sources
          .filter((source) => (source.sourceId === sourceId ? enabled : source.enabled))
          .map((source) => source.sourceId),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
      <div
        role="tablist"
        aria-label={t('managementTitle')}
        className="grid grid-cols-2 gap-1 rounded-t-2xl bg-[var(--color-surface-muted)] p-1"
      >
        <ManagerTab
          active={view === 'interests'}
          controls="interest-manager-interests"
          onClick={() => setView('interests')}
        >
          {t('interestsTab', { count })}
        </ManagerTab>
        <ManagerTab
          active={view === 'settings'}
          controls="interest-manager-settings"
          onClick={() => setView('settings')}
        >
          {t('settingsTab')}
        </ManagerTab>
      </div>

      {view === 'interests' ? (
        <section
          id="interest-manager-interests"
          role="tabpanel"
          className="animate-[megumi-panel-in_180ms_ease-out] space-y-5 p-6 motion-reduce:animate-none"
        >
          <form onSubmit={(event) => void addInterest(event)} className="flex gap-2">
            <label className="sr-only" htmlFor="new-discovery-interest">
              {t('addInterestLabel')}
            </label>
            <input
              id="new-discovery-interest"
              aria-label={t('addInterestLabel')}
              value={newInterest}
              disabled={busy}
              onChange={(event) => setNewInterest(event.target.value)}
              placeholder={t('addInterestPlaceholder')}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm text-[var(--color-text)] outline-none transition-shadow placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20"
            />
            <Button
              type="submit"
              variant="primary"
              className="min-h-11 rounded-xl"
              disabled={busy || !newInterest.trim()}
            >
              <Plus size={15} aria-hidden="true" />
              {t('add')}
            </Button>
          </form>

          {interests === null ? (
            <p className="text-sm text-[var(--color-text-muted)]">{t('loading')}</p>
          ) : null}

          {interests !== null && count === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-app-bg)]/55 px-6 py-8 text-center">
              <h3 className="text-base font-semibold tracking-[-0.02em] text-[var(--color-text)]">
                {t('noInterestsTitle')}
              </h3>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--color-text-muted)]">
                {t('noInterestsDescription')}
              </p>
            </div>
          ) : null}

          <div className="space-y-3">
            {savedInterests.map((interest) => {
              const editing = editingInterestId === interest.id;
              const menuOpen = menuInterestId === interest.id;
              return (
                <article
                  key={interest.id}
                  className="relative rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4 shadow-sm transition-shadow hover:shadow-[var(--shadow-soft)]"
                >
                  {editing ? (
                    <div className="animate-[megumi-panel-in_150ms_ease-out] motion-reduce:animate-none">
                      <label className="sr-only" htmlFor={`interest-editor-${interest.id}`}>
                        {t('editInterest', { description: interest.text })}
                      </label>
                      <textarea
                        id={`interest-editor-${interest.id}`}
                        autoFocus
                        rows={3}
                        value={drafts[interest.id] ?? interest.text}
                        disabled={busy}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [interest.id]: event.target.value }))
                        }
                        className="w-full resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-app-bg)] px-3 py-2.5 text-sm leading-6 text-[var(--color-text)] outline-none focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20"
                      />
                      <div className="mt-3 flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setEditingInterestId(null)}
                        >
                          {t('cancel')}
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy || !drafts[interest.id]?.trim()}
                          onClick={() => void saveInterest(interest.id)}
                        >
                          {t('saveChanges')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <InterestRow
                      text={interest.text}
                      enabled={interest.enabled}
                      busy={busy}
                      menuOpen={menuOpen}
                      moreActionsLabel={t('moreActions', { description: interest.text })}
                      editLabel={t('edit')}
                      deleteLabel={t('delete')}
                      stateLabel={t(interest.enabled ? 'active' : 'paused')}
                      switchLabel={`${t(interest.enabled ? 'pause' : 'resume')} ${interest.text}`}
                      onToggleMenu={() =>
                        setMenuInterestId(menuOpen ? null : interest.id)
                      }
                      onEdit={() => {
                        setMenuInterestId(null);
                        setDrafts((current) => ({ ...current, [interest.id]: interest.text }));
                        setEditingInterestId(interest.id);
                        setEditingRevision(interest.revision);
                      }}
                      onDelete={() => {
                        setMenuInterestId(null);
                        void change({ action: 'delete', interestId: interest.id, expectedRevision: interest.revision });
                      }}
                      onToggleEnabled={() =>
                        void change({
                          action: interest.enabled ? 'pause' : 'resume',
                          interestId: interest.id, expectedRevision: interest.revision,
                        })
                      }
                    />
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section
          id="interest-manager-settings"
          role="tabpanel"
          className="animate-[megumi-panel-in_180ms_ease-out] p-6 motion-reduce:animate-none"
        >
          <p className="text-sm leading-5 text-[var(--color-text-muted)]">
            {t('sourcesDescription')}
          </p>
          {sources ? (
            <div className="mt-4 space-y-2">
              {sources.map((source) => (
                <div
                  key={source.sourceId}
                  className="flex min-h-14 items-center justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-2"
                >
                  <span className="min-w-0 text-sm text-[var(--color-text)]">
                    <span className="block">{source.name}</span>
                    <span className="block text-xs text-[var(--color-text-muted)]">
                      {t(`contentSources.states.${source.state}`, { ns: 'settings' })}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy || !onOpenContentSources}
                      onClick={onOpenContentSources}
                    >
                      {t('configureSources')}
                    </Button>
                    <Switch
                      checked={source.enabled}
                      disabled={busy}
                      label={source.name}
                      onCheckedChange={(enabled) => void changeSource(source.sourceId, enabled)}
                    />
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--color-text-muted)]">{t('loading')}</p>
          )}
        </section>
      )}
    </section>
  );
}

function InterestRow(props: {
  text: string;
  enabled: boolean;
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
  onToggleEnabled(): void;
}) {
  return (
    <>
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm font-medium leading-6 text-[var(--color-text)]">
          {props.text}
        </p>
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
            <div
              role="menu"
              className="absolute right-0 top-11 z-20 min-w-32 animate-[megumi-panel-in_120ms_ease-out] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-1.5 shadow-[var(--shadow-soft)] motion-reduce:animate-none"
            >
              <button
                type="button"
                role="menuitem"
                onClick={props.onEdit}
                className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-muted)]"
              >
                <Pencil size={14} aria-hidden="true" />
                {props.editLabel}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={props.onDelete}
                className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-soft)]"
              >
                <Trash2 size={14} aria-hidden="true" />
                {props.deleteLabel}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-[var(--color-border)] pt-3">
        <span className="text-xs text-[var(--color-text-muted)]">{props.stateLabel}</span>
        <Switch
          checked={props.enabled}
          disabled={props.busy}
          label={props.switchLabel}
          onCheckedChange={props.onToggleEnabled}
        />
      </div>
    </>
  );
}

function ManagerTab({
  active,
  controls,
  onClick,
  children,
}: {
  active: boolean;
  controls: string;
  onClick(): void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      className={cx(
        'min-h-10 cursor-pointer rounded-lg px-3 text-sm font-medium transition-[background-color,color,box-shadow] duration-150',
        active
          ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
      )}
    >
      {children}
    </button>
  );
}

function Switch({
  checked,
  disabled,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onCheckedChange(checked: boolean): void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className="inline-flex h-11 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={cx(
          'relative h-6 w-11 rounded-full border transition-[background-color,border-color] duration-150',
          checked
            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
            : 'border-[var(--color-border-strong)] bg-[var(--color-surface-muted)]',
        )}
      >
        <span
          className={cx(
            'absolute left-0.5 top-0.5 h-[1.125rem] w-[1.125rem] rounded-full shadow-sm transition-[transform,background-color] duration-150 ease-out',
            checked
              ? 'translate-x-5 bg-[var(--color-accent-foreground)]'
              : 'translate-x-0 bg-[var(--color-text-subtle)]',
          )}
        />
      </span>
    </button>
  );
}
