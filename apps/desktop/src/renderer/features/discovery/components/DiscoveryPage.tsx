/* Owns the renderer projection for today, discovery history, search, and feedback. */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Bookmark, Heart, LoaderCircle, Search, Settings2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DiscoveryHomeUiResult, DiscoveryRecommendationUiDto } from '@megumi/product/host';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import { Button, cx } from '../../../shared/ui';
import { InterestManager } from './InterestManager';
import { RecommendationCard } from './RecommendationCard';

type HomeMode = DiscoveryHomeUiResult['mode'];
type RecommendationAction = Parameters<Parameters<typeof RecommendationCard>[0]['onAction']>[0];

interface DiscoveryPageProps {
  onStartConversation?(recommendation: DiscoveryRecommendationUiDto): void;
}

export function DiscoveryPage({ onStartConversation }: DiscoveryPageProps) {
  const { t, i18n } = useTranslation('discovery');
  const [home, setHome] = useState<DiscoveryHomeUiResult | null>(null);
  const [mode, setMode] = useState<HomeMode>('timeline');
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<DiscoveryRecommendationUiDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);

  const loadHome = useCallback(async (selectedMode: HomeMode = mode) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.megumi.discovery.getHome(createRendererRuntimeIpcRequest(
        IPC_CHANNELS.discovery.homeGet,
        { mode: selectedMode, limit: 60 },
      ));
      setLoading(false);
      if (!result.ok) {
        setError(t('loadFailed'));
        return;
      }
      setHome(result.data);
    } catch {
      setLoading(false);
      setError(t('loadFailed'));
    }
  }, [mode, t]);

  useEffect(() => { void loadHome('timeline'); }, []);
  useEffect(() => {
    if (home?.today.status !== 'running') return;
    const timer = window.setInterval(() => { void loadHome(mode); }, 3_000);
    return () => window.clearInterval(timer);
  }, [home?.today.status, loadHome, mode]);

  async function selectMode(next: HomeMode) {
    setMode(next);
    setActiveQuery(null);
    setQuery('');
    await loadHome(next);
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
    const result = await window.megumi.discovery.ensureDaily(createRendererRuntimeIpcRequest(
      IPC_CHANNELS.discovery.dailyEnsure,
      { trigger: 'manual', now: new Date().toISOString() },
    ));
    if (!result.ok || result.data.status === 'failed') {
      setError(t('actionFailed'));
      return;
    }
    await loadHome(mode);
  }

  async function updateState(recommendationId: string, action: RecommendationAction) {
    const result = await window.megumi.discovery.updateRecommendationState(createRendererRuntimeIpcRequest(
      IPC_CHANNELS.discovery.recommendationStateUpdate,
      { recommendationId, ...action },
    ));
    if (!result.ok) {
      setError(t('actionFailed'));
      return;
    }
    const update = (item: DiscoveryRecommendationUiDto) => item.recommendationId === recommendationId ? result.data : item;
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

  return (
    <div className="relative h-full w-full overflow-y-auto bg-[radial-gradient(circle_at_10%_0%,var(--color-accent-soft),transparent_26rem),var(--color-app-bg)]">
      <div className="mx-auto max-w-[94rem] px-5 pb-16 pt-6 sm:px-7 lg:px-10">
        <header className="mb-7 grid gap-5 xl:grid-cols-[minmax(18rem,1fr)_minmax(28rem,0.9fr)_auto] xl:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
              <Sparkles size={14} aria-hidden="true" /> Megumi briefing
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

        {loading && !home ? <StatusPanel icon={<LoaderCircle className="animate-spin" size={22} />} title={t('loading')} /> : null}
        {error ? <div role="alert" className="mb-6 rounded-2xl border border-[var(--color-danger)]/25 bg-[var(--color-danger-soft)] px-5 py-4 text-sm text-[var(--color-danger)]">{error}</div> : null}

        {home && !hasActiveInterests ? (
          <StatusPanel
            icon={<Sparkles size={24} />}
            title={t('noInterestsTitle')}
            description={t('noInterestsDescription')}
            action={<Button variant="primary" onClick={() => setManagerOpen(true)}>{t('addFirstInterest')}</Button>}
          />
        ) : null}

        {home && hasActiveInterests && home.today.status === 'not_generated' && mode === 'timeline' && !activeQuery ? (
          <StatusPanel title={t('notGenerated')} action={<Button variant="primary" onClick={() => void ensureToday()}>{t('generateNow')}</Button>} />
        ) : null}
        {home?.today.status === 'running' && mode === 'timeline' && !activeQuery ? <StatusPanel icon={<LoaderCircle className="animate-spin" size={22} />} title={t('running')} /> : null}
        {home?.today.status === 'failed' && mode === 'timeline' && !activeQuery ? (
          <StatusPanel title={t('failed')} description={home.today.failure?.message} action={<Button variant="primary" onClick={() => void ensureToday()}>{t('retry')}</Button>} />
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

        {!activeQuery && home?.days.map((day) => (
          <section key={day.localDate} className="mb-12">
            <div className="mb-4 flex items-end justify-between border-b border-[var(--color-border)] pb-3">
              <h2 className="text-xl font-semibold tracking-[-0.025em] text-[var(--color-text)]">
                {day.localDate === home.today.localDate
                  ? t('todayDate', { date: formatLocalDate(day.localDate, i18n.language) })
                  : formatHistoricalDate(day.localDate, i18n.language)}
              </h2>
              <span className="text-xs text-[var(--color-text-subtle)]">{t('resultCount', { count: day.recommendations.length })}</span>
            </div>
            <RecommendationGrid recommendations={day.recommendations} onAction={updateState} onChat={onStartConversation} />
          </section>
        ))}

        {!activeQuery && home && home.days.length === 0 && hasActiveInterests && !['not_generated', 'running', 'failed'].includes(home.today.status) ? <StatusPanel title={t('emptyMode')} /> : null}
      </div>

      <InterestManager open={managerOpen} interests={home?.interests ?? []} onClose={() => setManagerOpen(false)} onChanged={async () => loadHome(mode)} />
    </div>
  );
}

function RecommendationGrid({ recommendations, onAction, onChat }: {
  recommendations: DiscoveryRecommendationUiDto[];
  onAction(id: string, action: RecommendationAction): void;
  onChat?(recommendation: DiscoveryRecommendationUiDto): void;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3">
      {recommendations.map((recommendation) => (
        <RecommendationCard
          key={recommendation.recommendationId}
          recommendation={recommendation}
          onAction={(action) => void onAction(recommendation.recommendationId, action)}
          onChat={() => onChat?.(recommendation)}
        />
      ))}
    </div>
  );
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
