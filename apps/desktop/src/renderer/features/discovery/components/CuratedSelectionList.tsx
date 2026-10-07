/*
 * Reads persistent curated results and displays accepted, failed or insufficient swap outcomes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CuratedSelectionView, RecommendationRunView } from '@megumi/application/contracts';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import { Button } from '../../../shared/ui';
import { RecommendationCard } from './RecommendationCard';
/** Mounting and committed-change events only re-read local state. */
export function CuratedSelectionList() {
  const { t } = useTranslation('discovery');
  const [view, setView] = useState<CuratedSelectionView>();
  const [run, setRun] = useState<RecommendationRunView>();
  const [runId, setRunId] = useState<string>();
  const [error, setError] = useState(false);
  const [shortage, setShortage] = useState(false);
  const [starting, setStarting] = useState(false);
  const requestId = useRef<string | undefined>(undefined);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const id = ++sequence.current;
    try {
      const response = await window.megumi.recommendation.getCuratedSelection(createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.getCuratedSelection, {}));
      if (id !== sequence.current)
        return;
      if (!response.ok) {
        setError(true);
        return;
      }
      setView(response.data);
      setError(false);
      const active = response.data.activeRun ?? runId ?? response.data.lastRun;
      if (active) {
        const result = await window.megumi.recommendation.getRun(createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.getRun, { runId: active }));
        if (id === sequence.current && result.ok && result.data?.kind === 'curated') {
          setRun(result.data);
          setRunId(result.data.id);
        }
      }
    }
    catch {
      if (id === sequence.current)
        setError(true);
    }
  }, [runId]);
  useEffect(() => {
    void load();
    const unsubscribe = window.megumi.recommendation.onChanged(event => {
      if (['curated_selection', 'run', 'interest', 'favorite'].includes(event.kind))
        void load();
    });
    return () => { ++sequence.current; unsubscribe(); };
  }, [load]);
  const running = Boolean(view?.activeRun) || Boolean(run && ['queued', 'running'].includes(run.status));
  useEffect(() => {
    if (!running)
      return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load, running]);
  async function swap() {
    setStarting(true);
    setError(false);
    setShortage(false);
    try {
      requestId.current ??= crypto.randomUUID();
      const response = await window.megumi.recommendation.startCuratedSelection(createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.startCuratedSelection, { requestId: requestId.current }));
      if (!response.ok) {
        setError(true);
        return;
      }
      requestId.current = undefined;
      if (response.data.status === 'no_candidates')
        setShortage(true);
      else
        setRunId(response.data.runId);
      await load();
    }
    catch {
      setError(true);
    }
    finally {
      setStarting(false);
    }
  }
  return <section aria-label={t('curatedTitle')} className="mt-8 space-y-4">
    <header className="flex items-center justify-between gap-4"><h2 className="text-xl font-semibold">{t('curatedTitle')}</h2><Button disabled={starting || running} onClick={() => void swap()}>{t('swapCurated')}</Button></header>
    {error ? <p role="alert">{t('curatedFailed')}</p> : null}
    {running ? <p role="status">{t('curatedRunning')}</p> : null}
    {shortage ? <p role="status">{t('curatedShortage')}</p> : null}
    {view?.needsUpdate && view.selection ? <p>{t('curatedNeedsUpdate')}</p> : null}
    {view && !view.selection && !running ? <p>{t(view.supplyStatus.length ? 'curatedWaiting' : 'noInterestsTitle')}</p> : null}
    {run && ['failed', 'interrupted', 'cancelled', 'superseded'].includes(run.status) ? <p role="status">{t('curatedFailed')}{run.issues.map(issue => ` (${issue.code})`).join('')}</p> : null}
    {run?.status === 'partial' ? <p>{t('curatedPartial')}</p> : null}
    {view?.selection?.items.map(item => <RecommendationCard key={`${view.selection!.id}:${item.contentId}`} item={item} reason={item.reason} />)}
  </section>;
}
