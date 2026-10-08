/*
 * Reads pinned favorite cards locally and appends stable cursor pages.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FavoritesView } from '@megumi/application/contracts';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import { Button } from '../../../shared/ui';
import { RecommendationCard } from './RecommendationCard';

/** Favorites survive interest edits and do not start recommendation generation. */
export function FavoriteList() {
  const { t } = useTranslation('discovery');
  const [view, setView] = useState<FavoritesView>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async (cursor?: string) => {
    const id = ++sequence.current;
    setBusy(true);

    try {
      const result = await window.megumi.recommendation.listFavorites(
        createRendererRuntimeIpcRequest(
          IPC_CHANNELS.recommendation.listFavorites,
          cursor ? { cursor } : {},
        ),
      );
      if (id !== sequence.current) return;
      if (!result.ok) {
        setError(true);
        return;
      }

      setError(false);
      setView(previous =>
        cursor
          ? {
              ...result.data,
              items: [
                ...(previous?.items ?? []),
                ...result.data.items.filter(
                  item => !previous?.items.some(old => old.contentId === item.contentId),
                ),
              ],
            }
          : result.data,
      );
    } catch {
      if (id === sequence.current) setError(true);
    } finally {
      if (id === sequence.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const unsubscribe = window.megumi.recommendation.onChanged(event => {
      if (event.kind === 'favorite') void load();
    });
    return () => {
      ++sequence.current;
      unsubscribe();
    };
  }, [load]);

  return (
    <section aria-label={t('favoriteTitle')} className="mt-8 space-y-4">
      <h2 className="text-xl font-semibold">{t('favoriteTitle')}</h2>
      {error ? <p role="alert">{t('favoriteFailed')}</p> : null}
      {view && !view.items.length ? <p>{t('favoriteEmpty')}</p> : null}
      {view?.items.map(item => (
        <RecommendationCard key={item.contentId} item={item} />
      ))}
      {view?.nextCursor ? (
        <Button disabled={busy} onClick={() => void load(view.nextCursor)}>
          {t('loadMoreFavorites')}
        </Button>
      ) : null}
    </section>
  );
}
