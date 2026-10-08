/*
 * Connects saved interests, recommendation consent, daily results, selections and favorites.
 */
import { useCallback, useEffect, useState } from 'react';
import { Bookmark, CalendarDays, Settings2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { InterestUi, SupplySourceView } from '@megumi/application/contracts';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import { Button, cx } from '../../../shared/ui';
import { FirstSupplyConfirmationDialog } from './FirstSupplyConfirmationDialog';
import { InterestManager, type InterestEdit } from './InterestManager';
import { DailyFeedList } from './DailyFeedList';
import { CuratedSelectionList } from './CuratedSelectionList';
import { FavoriteList } from './FavoriteList';
import { RecommendationManagementDrawer } from './RecommendationManagementDrawer';

interface DiscoveryPageProps {
  onOpenContentSources?(): void;
}

/** Reads saved state on mount and sends explicit edits through the Recommendation Host. */
export function DiscoveryPage({ onOpenContentSources }: DiscoveryPageProps) {
  const { t } = useTranslation('discovery');
  const [interests, setInterests] = useState<InterestUi[] | null>(null);
  const [sources, setSources] = useState<SupplySourceView[] | null>(null);
  const [candidateSupplyConfirmed, setCandidateSupplyConfirmed] = useState(false);
  const [configurationRevision, setConfigurationRevision] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [supplyPromptOpen, setSupplyPromptOpen] = useState(false);
  const [supplyPromptShown, setSupplyPromptShown] = useState(false);
  const [confirmingSupply, setConfirmingSupply] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);

  const [page, setPage] = useState<'daily' | 'curated' | 'favorites'>('curated');
  const [managementOpen, setManagementOpen] = useState(false);

  /** Refreshes the authoritative revision after a rejected concurrent configuration edit. */
  const refreshConfiguration = useCallback(async () => {
    const result = await window.megumi.recommendation.getConfiguration(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.configurationGet, {}),
    );
    if (!result.ok) return false;

    setSources(result.data.sources);
    setCandidateSupplyConfirmed(result.data.config.enabled);
    setConfigurationRevision(result.data.revision);

    return true;
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [interestResult, configurationResult] = await Promise.all([
          window.megumi.recommendation.listInterests(
            createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.interestList, {}),
          ),
          window.megumi.recommendation.getConfiguration(
            createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.configurationGet, {}),
          ),
        ]);
        if (!active) return;
        if (!interestResult.ok || !configurationResult.ok) {
          setError(t('loadFailed'));
          return;
        }

        setInterests(interestResult.data.interests);
        setSources(configurationResult.data.sources);
        setCandidateSupplyConfirmed(configurationResult.data.config.enabled);
        setConfigurationRevision(configurationResult.data.revision);
      } catch {
        if (active) setError(t('loadFailed'));
      }
    })();
    return () => {
      active = false;
    };
  }, [t]);

  const hasEnabledInterest = interests?.some(interest => interest.enabled) ?? false;
  const needsSupplyConfirmation = hasEnabledInterest && !candidateSupplyConfirmed;
  useEffect(() => {
    if (!needsSupplyConfirmation) {
      setSupplyPromptOpen(false);
      return;
    }
    if (!supplyPromptShown) {
      setSupplyPromptShown(true);
      setSupplyPromptOpen(true);
    }
  }, [needsSupplyConfirmation, supplyPromptShown]);

  /** Saves one interest edit and re-reads the authoritative saved list. */
  const changeInterest = useCallback(
    async (request: InterestEdit): Promise<boolean> => {
      setError(null);

      try {
        const api = window.megumi.recommendation;
        const result = await (request.action === 'create'
          ? api.createInterest(
              createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.createInterest, {
                text: request.description,
              }),
            )
          : request.action === 'delete'
            ? api.deleteInterest(
                createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.deleteInterest, {
                  interestId: request.interestId,
                  expectedRevision: request.expectedRevision,
                }),
              )
            : api.updateInterest(
                createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.updateInterest, {
                  interestId: request.interestId,
                  expectedRevision: request.expectedRevision,
                  ...(request.action === 'update'
                    ? { text: request.description }
                    : { enabled: request.action === 'resume' }),
                }),
              ));
        if (!result.ok && result.data.code === 'REVISION_CONFLICT') {
          setError(t('revisionConflict'));
          const current = await window.megumi.recommendation.listInterests(
            createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.interestList, {}),
          );
          if (current.ok) setInterests(current.data.interests);

          return false;
        }
        if (!result.ok) {
          setError(t('actionFailed'));
          return false;
        }

        const current = await api.listInterests(
          createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.interestList, {}),
        );
        if (!current.ok) {
          setError(t('loadFailed'));
          return false;
        }

        setInterests(current.data.interests);

        return true;
      } catch {
        setError(t('actionFailed'));
        return false;
      }
    },
    [t],
  );
  /** Saves the enabled source set; supply only searches sources saved here. */
  const changeSources = useCallback(
    async (enabledSources: SupplySourceView['sourceId'][]): Promise<boolean> => {
      setError(null);

      try {
        const result = await window.megumi.recommendation.updateConfiguration(
          createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.configurationUpdate, {
            expectedRevision: configurationRevision,
            changes: { enabledSources },
          }),
        );
        if (!result.ok && result.data.code === 'REVISION_CONFLICT') {
          setError(t((await refreshConfiguration()) ? 'configurationConflict' : 'loadFailed'));
          return false;
        }
        if (!result.ok) {
          setError(t('actionFailed'));
          return false;
        }

        setSources(result.data.sources);
        setCandidateSupplyConfirmed(result.data.config.enabled);
        setConfigurationRevision(result.data.revision);

        return true;
      } catch {
        setError(t('actionFailed'));
        return false;
      }
    },
    [t, configurationRevision, refreshConfiguration],
  );

  /** Confirms through the Host before any supply work can start. */
  async function confirmFirstSupply() {
    if (confirmingSupply) return;

    setConfirmingSupply(true);
    setConfirmationError(null);

    try {
      const result = await window.megumi.recommendation.updateConfiguration(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.configurationUpdate, {
          expectedRevision: configurationRevision,
          changes: { enabled: true },
        }),
      );
      if (!result.ok && result.data.code === 'REVISION_CONFLICT') {
        setConfirmationError(
          t((await refreshConfiguration()) ? 'configurationConflict' : 'loadFailed'),
        );
        return;
      }
      if (!result.ok) {
        setConfirmationError(t('firstSupplyFailed'));
        return;
      }

      setSupplyPromptOpen(false);
      setCandidateSupplyConfirmed(true);
      setConfigurationRevision(result.data.revision);
    } catch {
      setConfirmationError(t('firstSupplyFailed'));
    } finally {
      setConfirmingSupply(false);
    }
  }

  const pages = [
    {
      id: 'curated',
      label: 'curatedTitle',
      icon: Sparkles,
    },
    {
      id: 'daily',
      label: 'dailyNavigation',
      icon: CalendarDays,
    },
    {
      id: 'favorites',
      label: 'favoriteTitle',
      icon: Bookmark,
    },
  ] as const;

  return (
    <div className="relative h-full w-full bg-[var(--color-app-bg)] text-[var(--color-text)]">
      <div
        inert={managementOpen || supplyPromptOpen}
        className="h-full overflow-y-auto [scrollbar-gutter:stable]"
      >
        <div className="mx-auto max-w-[62rem] px-5 pb-16 pt-7 sm:px-8 lg:px-10">
          <header className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-medium tracking-wide text-[var(--color-accent)]">
                {t('eyebrow')}
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t('title')}</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--color-text-muted)]">
                {t('subtitle')}
              </p>
            </div>
            <Button
              variant="secondary"
              className="min-h-11 rounded-xl"
              aria-haspopup="dialog"
              aria-expanded={managementOpen}
              onClick={() => setManagementOpen(true)}
            >
              <Settings2 size={16} aria-hidden="true" />
              {t('manageInterestsAndSources')}
            </Button>
          </header>
          <nav
            aria-label={t('resultNavigation')}
            className="mt-7 flex gap-1 border-b border-[var(--color-border)]"
          >
            {pages.map(entry => (
              <button
                key={entry.id}
                type="button"
                aria-current={page === entry.id ? 'page' : undefined}
                onClick={() => setPage(entry.id)}
                className={cx(
                  'flex min-h-12 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                  page === entry.id
                    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                    : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
                )}
              >
                <entry.icon size={16} aria-hidden="true" />
                {t(entry.label)}
              </button>
            ))}
          </nav>
          {error && !managementOpen ? (
            <p
              role="alert"
              className="mt-5 rounded-xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]"
            >
              {error}
            </p>
          ) : null}
          {needsSupplyConfirmation ? (
            <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold">{t('firstSupplyTitle')}</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-text-muted)]">
                  {t('firstSupplyDescription')}
                </p>
              </div>
              <Button
                onClick={() => {
                  setConfirmationError(null);
                  setSupplyPromptOpen(true);
                }}
              >
                {t('startFirstSupply')}
              </Button>
            </section>
          ) : null}
          <div key={page} className="ui-content-enter">
            {page === 'daily' ? (
              <DailyFeedList />
            ) : page === 'curated' ? (
              <CuratedSelectionList />
            ) : (
              <FavoriteList />
            )}
          </div>
        </div>
      </div>
      {managementOpen ? (
        <RecommendationManagementDrawer onClose={() => setManagementOpen(false)}>
          {error ? (
            <p role="alert" className="mb-4 text-sm text-[var(--color-danger)]">
              {error}
            </p>
          ) : null}
          <InterestManager
            interests={interests}
            sources={sources}
            onChangeInterest={changeInterest}
            onChangeSources={changeSources}
            onOpenContentSources={
              onOpenContentSources
                ? () => {
                    setManagementOpen(false);
                    onOpenContentSources();
                  }
                : undefined
            }
          />
        </RecommendationManagementDrawer>
      ) : null}
      {supplyPromptOpen && needsSupplyConfirmation ? (
        <FirstSupplyConfirmationDialog
          busy={confirmingSupply}
          error={confirmationError}
          onDefer={() => setSupplyPromptOpen(false)}
          onConfirm={() => void confirmFirstSupply()}
        />
      ) : null}
    </div>
  );
}
