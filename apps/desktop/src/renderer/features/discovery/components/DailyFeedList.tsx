/*
 * Displays saved daily batches and permits explicit retries for today's unfinished work.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DailyFeedView } from '@megumi/application/contracts';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import { Button } from '../../../shared/ui';
import {RecommendationCard} from './RecommendationCard';
/** Reads saved results on navigation; acquisition starts only after an explicit action. */
export function DailyFeedList() {
  const { t } = useTranslation('discovery');
  const [feed, setFeed] = useState<DailyFeedView>();
  const [today, setToday] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState(false);
  const [starting, setStarting] = useState(false);
  const sequence = useRef(0);
  const retryRequestId=useRef<string|undefined>(undefined);
  const load = useCallback(async () => {
    const requestSequence = ++sequence.current;
    try {
      const [result,current]=await Promise.all([
        window.megumi.recommendation.listDailyFeed(createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.listDailyFeed,date?{date}:{})),
        date?window.megumi.recommendation.listDailyFeed(createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.listDailyFeed,{})):Promise.resolve(undefined),
      ]);
      if (requestSequence !== sequence.current)
        return;
      if (!result.ok) {
        setError(true);
        return;
      }
      setError(false);
      setFeed(result.data);
      if (!date)setToday(result.data.date);
      else if(current?.ok)setToday(current.data.date);
    }
    catch {
      if (requestSequence === sequence.current)
        setError(true);
    }
  }, [date]);
  useEffect(() => {
    void load();
    const unsubscribe = window.megumi.recommendation.onChanged(event => {
      if (['daily_feed', 'run', 'interest', 'favorite'].includes(event.kind))
        void load();
    });
    return () => { ++sequence.current; unsubscribe(); };
  }, [load]);
  async function retry() {
    setStarting(true);
    try {
      retryRequestId.current??=crypto.randomUUID();
      const result = await window.megumi.recommendation.startDailyFeed(createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.startDailyFeed, { requestId:retryRequestId.current }));
      if (!result.ok)
        setError(true);
      else {retryRequestId.current=undefined;await load();}
    }
    catch {
      setError(true);
    }
    finally {
      setStarting(false);
    }
  }
  const dates = today ? Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(`${today}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - offset);
    return day.toISOString().slice(0, 10);
  }) : [];
  const isToday = !date || date === today;
  const running = Boolean(feed?.activeRuns.length);
  const unfinished = !feed?.batches.length || feed.batches.some(batch => ['failed', 'partial'].includes(batch.status));
  return (<section aria-label={t('dailyTitle')} className="mt-7 space-y-4">
    <header className="flex items-center justify-between gap-4">
      <h2 className="text-xl font-semibold">{t('dailyTitle')}</h2>
      <select aria-label={t('dailyDate')} value={date || today} onChange={event => { setFeed(undefined); setDate(event.target.value); }} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
        {dates.map(day => <option key={day} value={day}>{day}</option>)}
      </select>
    </header>
    {error ? <p role="alert">{t('dailyLoadFailed')}</p> : null}
    {!feed ? <p>{t('dailyLoading')}</p> : null}
    {running ? <p role="status">{t('dailyRunning')}</p> : null}
    {feed && !feed.items.length && !running ? <p>{t(!feed.batches.length ? 'dailyWaiting' : feed.batches.some(batch => batch.status === 'failed') ? 'dailyFailed' : 'dailyEmpty')}</p> : null}
    {feed?.batches.filter(batch => ['failed', 'partial'].includes(batch.status)).map(batch => (<p key={batch.id} className="text-sm text-[var(--color-text-muted)]">
      {batch.interestText}：{t(batch.status === 'partial' ? 'dailyPartial' : 'dailyFailed')}
      {batch.issues.map(issue => ` (${issue.code})`).join('')}
    </p>))}
    {isToday && unfinished ? <Button disabled={starting || running} onClick={() => void retry()}>{t('dailyRetry')}</Button> : null}
    <div className="space-y-3">
      {feed?.items.map(item => <RecommendationCard key={item.contentId} item={item}/>)}
    </div>
  </section>);
}
