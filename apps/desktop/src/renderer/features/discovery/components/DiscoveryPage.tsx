/*
 * Owns the interests and content-supply page: the saved interests, the source
 * enable state, and the first-supply consent.
 */
import { useCallback, useEffect, useState } from 'react';
import { Settings2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  DiscoveryInterestChangePayload,
  InterestUi,
  SupplySourceView,
} from '@megumi/application/contracts';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import { Button } from '../../../shared/ui';
import { FirstSupplyConfirmationDialog } from './FirstSupplyConfirmationDialog';
import { InterestManager } from './InterestManager';

interface DiscoveryPageProps {
  onOpenContentSources?(): void;
}

export function DiscoveryPage({ onOpenContentSources }: DiscoveryPageProps) {
  const { t } = useTranslation('discovery');
  const [interests, setInterests] = useState<InterestUi[] | null>(null);
  const [sources, setSources] = useState<SupplySourceView[] | null>(null);
  const [candidateSupplyConfirmed, setCandidateSupplyConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supplyPromptOpen, setSupplyPromptOpen] = useState(false);
  const [supplyPromptShown, setSupplyPromptShown] = useState(false);
  const [confirmingSupply, setConfirmingSupply] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [interestResult, configurationResult] = await Promise.all([
          window.megumi.discovery.listInterests(
            createRendererRuntimeIpcRequest(IPC_CHANNELS.discovery.interestList, {}),
          ),
          window.megumi.discovery.getConfiguration(
            createRendererRuntimeIpcRequest(IPC_CHANNELS.discovery.configurationGet, {}),
          ),
        ]);
        if (!active) return;
        if (!interestResult.ok || !configurationResult.ok) {
          setError(t('loadFailed'));
          return;
        }
        setInterests(interestResult.data.interests);
        setSources(configurationResult.data.sources);
        setCandidateSupplyConfirmed(configurationResult.data.candidateSupplyConfirmed);
      } catch {
        if (active) setError(t('loadFailed'));
      }
    })();
    return () => {
      active = false;
    };
  }, [t]);

  const hasEnabledInterest = interests?.some((interest) => interest.enabled) ?? false;
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

  /** Saves one interest edit and adopts the saved list the Host returns. */
  const changeInterest = useCallback(
    async (request: DiscoveryInterestChangePayload): Promise<boolean> => {
      setError(null);
      try {
        const result = await window.megumi.discovery.changeInterest(
          createRendererRuntimeIpcRequest(IPC_CHANNELS.discovery.interestChange, request),
        );
        if (result.ok && result.data.status === 'revision_conflict') {
          setError(t('revisionConflict'));
          const current = await window.megumi.discovery.listInterests(
            createRendererRuntimeIpcRequest(IPC_CHANNELS.discovery.interestList, {}),
          );
          if (current.ok) setInterests(current.data.interests);
          return false;
        }
        if (!result.ok || result.data.status !== 'changed') {
          setError(t('actionFailed'));
          return false;
        }
        setInterests(result.data.interests);
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
        const result = await window.megumi.discovery.updateConfiguration(
          createRendererRuntimeIpcRequest(IPC_CHANNELS.discovery.configurationUpdate, {
            enabledSources,
          }),
        );
        if (!result.ok) {
          setError(t('actionFailed'));
          return false;
        }
        setSources(result.data.sources);
        setCandidateSupplyConfirmed(result.data.candidateSupplyConfirmed);
        return true;
      } catch {
        setError(t('actionFailed'));
        return false;
      }
    },
    [t],
  );

  /** Confirms through the Host before any supply work can start. */
  async function confirmFirstSupply() {
    if (confirmingSupply) return;
    setConfirmingSupply(true);
    setConfirmationError(null);
    try {
      const result = await window.megumi.discovery.confirmCandidateSupply(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.discovery.candidateSupplyConfirm, {}),
      );
      if (!result.ok) {
        setConfirmationError(t('firstSupplyFailed'));
        return;
      }
      setSupplyPromptOpen(false);
      setCandidateSupplyConfirmed(true);
    } catch {
      setConfirmationError(t('firstSupplyFailed'));
    } finally {
      setConfirmingSupply(false);
    }
  }

  return (
    <div className="relative h-full w-full overflow-y-auto [scrollbar-gutter:stable] bg-[radial-gradient(circle_at_10%_0%,var(--color-accent-soft),transparent_26rem),var(--color-app-bg)]">
      <div className="mx-auto max-w-[62rem] px-5 pb-16 pt-6 sm:px-7 lg:px-10">
        <header className="mb-7 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
              <Sparkles size={14} aria-hidden="true" /> {t('eyebrow')}
            </div>
            <h1 className="text-[clamp(2rem,4vw,3.25rem)] font-semibold leading-none tracking-[-0.055em] text-[var(--color-text)]">
              {t('title')}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-text-muted)]">
              {t('subtitle')}
            </p>
          </div>
          <Button
            variant="secondary"
            className="h-11 rounded-xl"
            disabled={!onOpenContentSources}
            onClick={onOpenContentSources}
          >
            <Settings2 size={16} aria-hidden="true" />
            {t('manageSources')}
          </Button>
        </header>

        {error ? (
          <div
            role="alert"
            className="mb-6 rounded-2xl border border-[var(--color-danger)]/25 bg-[var(--color-danger-soft)] px-5 py-4 text-sm text-[var(--color-danger)]"
          >
            {error}
          </div>
        ) : null}

        {needsSupplyConfirmation ? (
          <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">
                {t('firstSupplyTitle')}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-text-muted)]">
                {t('firstSupplyDescription')}
              </p>
            </div>
            <Button
              variant="primary"
              className="h-11 rounded-xl"
              onClick={() => {
                setConfirmationError(null);
                setSupplyPromptOpen(true);
              }}
            >
              {t('startFirstSupply')}
            </Button>
          </section>
        ) : null}

        <InterestManager
          interests={interests}
          sources={sources}
          onChangeInterest={changeInterest}
          onChangeSources={changeSources}
          onOpenContentSources={onOpenContentSources}
        />
      </div>

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
