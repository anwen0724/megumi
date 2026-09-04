/*
 * Owns Discovery presentation, first-use consent, progress, search, and feedback.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Bookmark, ChevronDown, ChevronUp, Heart, LoaderCircle, Search, Settings2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DiscoveryHomeUiResult, DiscoveryRecommendationUiDto } from '@megumi/product-host/host';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import { localizeRendererError, rendererError } from '../../../shared/i18n';
import { Button, cx } from '../../../shared/ui';
import { InterestManager } from './InterestManager';
import { RecommendationCard } from './RecommendationCard';
import { FirstSupplyConfirmationDialog } from './FirstSupplyConfirmationDialog';

type HomeMode = DiscoveryHomeUiResult['mode'];
type RecommendationAction = Parameters<Parameters<typeof RecommendationCard>[0]['onAction']>[0];

interface DiscoveryPageProps {
  onStartConversation?(recommendation: DiscoveryRecommendationUiDto): void;
  onOpenContentSources?(): void;
}

export function DiscoveryPage({ onStartConversation, onOpenContentSources }: DiscoveryPageProps) {
  const { t, i18n } = useTranslation('discovery');
  const [home, setHome] = useState<DiscoveryHomeUiResult | null>(null);
  const [mode, setMode] = useState<HomeMode>('timeline');
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<DiscoveryRecommendationUiDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const homeRequestSequence = useRef(0);
  const [supplyPromptOpen, setSupplyPromptOpen] = useState(false);
  const [supplyPromptShown, setSupplyPromptShown] = useState(false);
  const [confirmingSupply, setConfirmingSupply] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const confirmationPending = useRef(false);

  const loadHome = useCallback(async (selectedMode: HomeMode) => {
    const requestSequence = ++homeRequestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const result = await window.megumi.discovery.getHome(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.discovery.homeGet,
        { mode: selectedMode, limit: 60 },
      ));
      if (requestSequence !== homeRequestSequence.current) return;
      setLoading(false);
      if (!result.ok) {
        setError(t('loadFailed'));
        return;
      }
      setHome(result.data);
    } catch {
      if (requestSequence !== homeRequestSequence.current) return;
      setLoading(false);
      setError(t('loadFailed'));
    }
  }, [t]);

  useEffect(() => { void loadHome('timeline'); }, []);
  useEffect(() => {
    if (home?.candidateSupplyConfirmed || !home?.interests.some(({ status }) => status === 'active')) {
      setSupplyPromptOpen(false);
      return;
    }
    if (!supplyPromptShown && !managerOpen) {
      setSupplyPromptShown(true);
      setSupplyPromptOpen(true);
    }
  }, [home, supplyPromptShown, managerOpen]);
  useEffect(() => {
    const status = home?.today.status;
    if (
      status !== 'running'
      && status !== 'waiting_for_candidates'
      && home?.candidateSupplyStatus.status !== 'running'
      && !(status === 'not_generated' && !home?.nextScheduledAt)
    ) return;
    const timer = window.setInterval(() => { void loadHome(mode); }, 3_000);
    return () => window.clearInterval(timer);
  }, [home?.nextScheduledAt, home?.today.status, home?.candidateSupplyStatus.status, loadHome, mode]);

  /** Confirms through the Host before refreshing authoritative progress; never starts Recommendation. */
  async function confirmFirstSupply() {
    if (confirmationPending.current) return;
    confirmationPending.current = true;
    setConfirmingSupply(true);
    setConfirmationError(null);
    try {
      const result = await window.megumi.discovery.confirmCandidateSupply(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.discovery.candidateSupplyConfirm, {},
      ));
      if (!result.ok) { setConfirmationError(t('firstSupplyFailed')); return; }
      setSupplyPromptOpen(false);
      await loadHome(mode);
    } catch {
      setConfirmationError(t('firstSupplyFailed'));
    } finally {
      confirmationPending.current = false;
      setConfirmingSupply(false);
    }
  }

  function selectMode(next: HomeMode) {
    if (next === mode && !activeQuery) return;
    setMode(next);
    setActiveQuery(null);
    setQuery('');
    void loadHome(next);
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized) {
      setActiveQuery(null);
      await loadHome(mode);
      return;
    }
    setLoading(true);
    setError(null);
    const result = await window.megumi.discovery.searchRecommendations(createRendererRuntimeIpcRequest(
      IPC_CHANNELS.discovery.recommendationsSearch,
      { query: normalized, limit: 60 },
    ));
    setLoading(false);
    if (!result.ok) {
      setError(t('loadFailed'));
      return;
    }
    setActiveQuery(result.data.query);
    setSearchResults(result.data.recommendations);
  }

  async function ensureToday() {
    setError(null);
    try {
      const result = await window.megumi.discovery.requestRecommendation(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.discovery.recommendationRequest,
        { trigger: 'manual' },
      ));
      if (!result.ok) {
        setError(recommendationFailureMessage());
        return;
      }
      if (result.data.status === 'failed') {
        setError(recommendationFailureMessage(result.data.failure));
        return;
      }
      if (result.data.status === 'model_unavailable') {
        setError(recommendationFailureMessage({ code: 'model_unavailable', message: '' }));
        return;
      }
      await loadHome(mode);
    } catch {
      setError(recommendationFailureMessage());
    }
  }

  async function updateState(recommendationId: string, action: RecommendationAction) {
    const result = await window.megumi.discovery.updateRecommendationState(createRendererRuntimeIpcRequest(
      IPC_CHANNELS.discovery.recommendationStateUpdate,
      { recommendationId, ...action },
    ));
    if (!result.ok || result.data.status === 'not_found') {
      setError(t('actionFailed'));
      return;
    }
    const state = result.data.state;
    const update = (item: DiscoveryRecommendationUiDto): DiscoveryRecommendationUiDto => (
      item.recommendationId === recommendationId
        ? {
            ...item,
            ...(state.reaction ? { reaction: state.reaction } : { reaction: undefined }),
            hidden: state.hiddenAt !== undefined,
            favorite: state.favoriteAt !== undefined,
            watchLater: state.watchLaterAt !== undefined,
            ...(state.firstOpenedAt ? { firstOpenedAt: state.firstOpenedAt } : {}),
            ...(state.lastOpenedAt ? { lastOpenedAt: state.lastOpenedAt } : {}),
          }
        : item
    );
    setSearchResults((items) => action.action === 'set_hidden' && action.hidden ? items.filter((item) => item.recommendationId !== recommendationId) : items.map(update));
    setHome((current) => current ? {
      ...current,
      days: current.days.map((day) => ({
        ...day,
        recommendations: action.action === 'set_hidden' && action.hidden
          ? day.recommendations.filter((item) => item.recommendationId !== recommendationId)
          : day.recommendations.map(update),
      })),
    } : current);
  }

  const recommendations = useMemo(() => activeQuery ? searchResults : [], [activeQuery, searchResults]);
  const hasActiveInterests = home?.interests.some((interest) => interest.status === 'active') ?? false;
  const modeHome = home?.mode === mode ? home : null;
  const needsSupplyConfirmation = Boolean(home && hasActiveInterests && !home.candidateSupplyConfirmed);
  const supplyRunning = home?.candidateSupplyStatus.status === 'running';
  const showRecommendationStatus = hasActiveInterests && !needsSupplyConfirmation && mode === 'timeline' && !activeQuery;

  return (
    <div className="relative h-full w-full overflow-y-auto [scrollbar-gutter:stable] bg-[radial-gradient(circle_at_10%_0%,var(--color-accent-soft),transparent_26rem),var(--color-app-bg)]">
      <div className="mx-auto max-w-[94rem] px-5 pb-16 pt-6 sm:px-7 lg:px-10">
        <header className="mb-7 grid gap-5 xl:grid-cols-[minmax(18rem,1fr)_minmax(28rem,0.9fr)_auto] xl:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
              <Sparkles size={14} aria-hidden="true" /> {t('eyebrow')}
            </div>
            <h1 className="text-[clamp(2rem,4vw,3.65rem)] font-semibold leading-none tracking-[-0.055em] text-[var(--color-text)]">{t('title')}</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-text-muted)]">{t('subtitle')}</p>
          </div>
          <form role="search" onSubmit={(event) => void search(event)} className="flex rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-sm focus-within:border-[var(--color-focus)] focus-within:ring-2 focus-within:ring-[var(--color-focus)]/15">
            <Search className="ml-3 self-center text-[var(--color-text-subtle)]" size={17} aria-hidden="true" />
            <input
              type="search"
              aria-label={t('searchLabel')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('searchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)]"
            />
            <Button type="submit" variant="primary" className="rounded-xl">{t('search')}</Button>
          </form>
          <Button variant="secondary" className="h-11 rounded-xl" onClick={() => setManagerOpen(true)}><Settings2 size={16} />{t('manageInterests')}</Button>
        </header>

        <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-y border-[var(--color-border)] py-3">
          <nav aria-label={t('title')} className="flex items-center gap-1">
            <ModeButton active={!activeQuery && mode === 'timeline'} onClick={() => void selectMode('timeline')}>{t('timeline')}</ModeButton>
            <ModeButton active={!activeQuery && mode === 'favorites'} onClick={() => void selectMode('favorites')}><Heart size={14} />{t('favorites')} {home?.favoriteCount ? `· ${home.favoriteCount}` : ''}</ModeButton>
            <ModeButton active={!activeQuery && mode === 'watch_later'} onClick={() => void selectMode('watch_later')}><Bookmark size={14} />{t('watchLater')} {home?.watchLaterCount ? `· ${home.watchLaterCount}` : ''}</ModeButton>
          </nav>
          {home?.nextScheduledAt ? <p className="text-xs text-[var(--color-text-subtle)]">{t('nextRun', { time: formatSchedule(home.nextScheduledAt, i18n.language) })}</p> : null}
        </div>

        {loading && !modeHome && (!home || hasActiveInterests) ? <StatusPanel icon={<LoaderCircle className="animate-spin" size={22} />} title={t('loading')} /> : null}
        {error ? <div role="alert" className="mb-6 rounded-2xl border border-[var(--color-danger)]/25 bg-[var(--color-danger-soft)] px-5 py-4 text-sm text-[var(--color-danger)]">{error}</div> : null}

        {home && !hasActiveInterests ? (
          <StatusPanel
            icon={<Sparkles size={24} />}
            title={t('noInterestsTitle')}
            description={t('noInterestsDescription')}
            action={<Button variant="primary" onClick={() => setManagerOpen(true)}>{t('addFirstInterest')}</Button>}
          />
        ) : null}

        {needsSupplyConfirmation && mode === 'timeline' && !activeQuery ? (
          <StatusPanel title={t('firstSupplyTitle')} action={<Button variant="primary" onClick={() => {
            setConfirmationError(null); setSupplyPromptOpen(true);
          }}>{t('startFirstSupply')}</Button>} />
        ) : null}
        {showRecommendationStatus && home?.candidateSupplyStatus.status === 'failed' ? (
          <div role="alert" className="mb-6 rounded-2xl bg-[var(--color-danger-soft)] p-5 text-sm text-[var(--color-danger)]">
            {localizeRendererError(rendererError(home.candidateSupplyStatus.failure.code,
              home.candidateSupplyStatus.failure.message, undefined, 'candidate_supply_failed'))}
          </div>
        ) : null}
        {showRecommendationStatus && home?.today.status === 'not_generated' && !supplyRunning ? (
          <StatusPanel title={t('notGenerated')} action={<Button variant="primary" onClick={() => void ensureToday()}>{t('generateNow')}</Button>} />
        ) : null}
        {showRecommendationStatus && home?.today.status === 'running' ? <StatusPanel icon={<LoaderCircle className="animate-spin" size={22} />} title={t('running')} /> : null}
        {showRecommendationStatus && (home?.today.status === 'waiting_for_candidates' || (home?.today.status === 'not_generated' && supplyRunning)) ? (
          <StatusPanel
            icon={<LoaderCircle className="animate-spin" size={22} />}
            title={t('waitingForCandidates')}
          />
        ) : null}
        {showRecommendationStatus && home?.today.status === 'failed' ? (
          <StatusPanel title={t('failed')} description={recommendationFailureMessage(home.today.failure)} action={<Button variant="primary" onClick={() => void ensureToday()}>{t('retry')}</Button>} />
        ) : null}
        {showRecommendationStatus && home?.today.status === 'model_unavailable' ? (
          <StatusPanel title={t('failed')} description={localizeRendererError(rendererError('model_unavailable'))} action={<Button variant="primary" onClick={() => void ensureToday()}>{t('retry')}</Button>} />
        ) : null}

        {activeQuery ? (
          <section>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold tracking-[-0.025em] text-[var(--color-text)]">{t('searchResults', { query: activeQuery })}</h2>
              <Button size="sm" variant="ghost" onClick={() => { setActiveQuery(null); setQuery(''); }}>{t('clearSearch')}</Button>
            </div>
            {recommendations.length ? (
              <RecommendationGrid recommendations={recommendations} onAction={updateState} onChat={onStartConversation} />
            ) : <StatusPanel title={t('emptySearch')} />}
          </section>
        ) : null}

        {!activeQuery && modeHome?.days.map((day) => (
          <section key={day.localDate} className="mb-12">
            <div className="mb-4 flex items-end justify-between border-b border-[var(--color-border)] pb-3">
              <h2 className="text-xl font-semibold tracking-[-0.025em] text-[var(--color-text)]">
                {day.localDate === modeHome.today.localDate
                  ? t('todayDate', { date: formatLocalDate(day.localDate, i18n.language) })
                  : formatHistoricalDate(day.localDate, i18n.language)}
              </h2>
              <span className="text-xs text-[var(--color-text-subtle)]">{t('resultCount', { count: day.recommendations.length })}</span>
            </div>
            <RecommendationGrid
              recommendations={day.recommendations}
              collapsedRows={mode === 'timeline' ? 2 : undefined}
              onAction={updateState}
              onChat={onStartConversation}
            />
          </section>
        ))}

        {!activeQuery && modeHome && modeHome.days.length === 0 && hasActiveInterests && !['not_generated', 'waiting_for_candidates', 'running', 'failed', 'model_unavailable'].includes(modeHome.today.status) ? <StatusPanel title={t('emptyMode')} /> : null}
      </div>

      <InterestManager
        open={managerOpen}
        interests={home?.interests ?? []}
        onClose={() => setManagerOpen(false)}
        onChanged={async () => loadHome(mode)}
        onOpenContentSources={onOpenContentSources}
      />
      {supplyPromptOpen && needsSupplyConfirmation ? <FirstSupplyConfirmationDialog
        busy={confirmingSupply} error={confirmationError}
        onDefer={() => setSupplyPromptOpen(false)} onConfirm={() => void confirmFirstSupply()}
      /> : null}
    </div>
  );
}

/** Localizes known failures without rendering provider bodies or changing diagnostic facts. */
function recommendationFailureMessage(
  failure?: Pick<NonNullable<DiscoveryHomeUiResult['today']['failure']>, 'code' | 'message'>,
): string {
  let code = failure?.code ?? 'recommendation_failed';
  // Execution failures currently carry provider HTTP status in the message, not a separate field.
  // Recognize only the leading status; arbitrary numbers in an error body are not HTTP status codes.
  if (code === 'agent_execution_failed') {
    const status = /^\s*(\d{3})\b/.exec(failure?.message ?? '')?.[1];
    if (status === '402') code = 'model_payment_required';
    else if (status === '401') code = 'model_authentication_failed';
    else if (status === '429') code = 'model_rate_limited';
    else if (status?.startsWith('5')) code = 'model_service_unavailable';
  }
  return localizeRendererError(rendererError(code, failure?.message, undefined, 'recommendation_failed'));
}

function RecommendationGrid({ recommendations, collapsedRows, onAction, onChat }: {
  recommendations: DiscoveryRecommendationUiDto[];
  collapsedRows?: number;
  onAction(id: string, action: RecommendationAction): void;
  onChat?(recommendation: DiscoveryRecommendationUiDto): void;
}) {
  const { t } = useTranslation('discovery');
  const gridId = useId();
  const columnCount = useRecommendationColumnCount();
  const [expanded, setExpanded] = useState(false);
  const collapsedLimit = collapsedRows ? collapsedRows * columnCount : recommendations.length;
  const canToggle = collapsedRows !== undefined && recommendations.length > collapsedLimit;
  const visibleRecommendations = expanded || collapsedRows === undefined
    ? recommendations
    : recommendations.slice(0, collapsedLimit);

  return (
    <>
      <div id={gridId} className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3">
        {visibleRecommendations.map((recommendation) => (
          <RecommendationCard
            key={recommendation.recommendationId}
            recommendation={recommendation}
            onAction={(action) => void onAction(recommendation.recommendationId, action)}
            onChat={() => onChat?.(recommendation)}
          />
        ))}
      </div>
      {canToggle ? (
        <Button
          variant="ghost"
          aria-controls={gridId}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="mt-5 h-11 w-full rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/55 text-[var(--color-text-muted)] hover:border-[var(--color-accent)]/45 hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
        >
          {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          {expanded
            ? t('collapseRecommendations')
            : t('showMoreRecommendations', { count: recommendations.length - collapsedLimit })}
        </Button>
      ) : null}
    </>
  );
}

function useRecommendationColumnCount(): number {
  const [columnCount, setColumnCount] = useState(readRecommendationColumnCount);

  useEffect(() => {
    const update = () => setColumnCount(readRecommendationColumnCount());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return columnCount;
}

function readRecommendationColumnCount(): number {
  if (window.innerWidth >= 1536) return 3;
  if (window.innerWidth >= 768) return 2;
  return 1;
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick(): void; children: React.ReactNode }) {
  return <button type="button" aria-current={active ? 'page' : undefined} onClick={onClick} className={cx('inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition', active ? 'bg-[var(--color-text)] text-[var(--color-app-bg)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]')}>{children}</button>;
}

function StatusPanel({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <section className="mx-auto my-14 flex max-w-2xl flex-col items-center rounded-[1.75rem] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/75 px-8 py-14 text-center">
      {icon ? <div className="mb-4 text-[var(--color-accent)]">{icon}</div> : null}
      <h2 className="text-xl font-semibold tracking-[-0.025em] text-[var(--color-text)]">{title}</h2>
      {description ? <p className="mt-2 max-w-lg text-sm leading-6 text-[var(--color-text-muted)]">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}

function formatLocalDate(localDate: string, language: string): string {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Intl.DateTimeFormat(language, { month: 'long', day: 'numeric' }).format(new Date(year, month - 1, day));
}

function formatHistoricalDate(localDate: string, language: string): string {
  return `${formatLocalDate(localDate, language)} · ${localDate.slice(0, 4)}`;
}

function formatSchedule(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
