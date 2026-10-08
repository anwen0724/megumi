/*
 * Presents saved material scope and explicit favorite or original-content actions.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ContentCard } from '@megumi/application/contracts';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import { Button } from '../../../shared/ui';

/** Actions use saved identities; a card never starts source acquisition. */
export function RecommendationCard({ item, reason }: { item: ContentCard; reason?: string }) {
  const { t } = useTranslation('discovery');
  const [saved, setSaved] = useState(item.saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => setSaved(item.saved), [item.saved]);

  async function act(kind: 'favorite' | 'open') {
    setBusy(true);
    setError(false);

    try {
      if (kind === 'open') {
        const response = await window.megumi.recommendation.openContent(
          createRendererRuntimeIpcRequest(IPC_CHANNELS.recommendation.openContent, {
            contentId: item.contentId,
          }),
        );
        setError(!response.ok);
      } else {
        const response = await window.megumi.recommendation.setFavorite(
          createRendererRuntimeIpcRequest(
            IPC_CHANNELS.recommendation.setFavorite,
            saved
              ? {
                  contentId: item.contentId,
                  saved: false,
                }
              : {
                  contentId: item.contentId,
                  materialId: item.materialId,
                  saved: true,
                },
          ),
        );
        if (response.ok) setSaved(response.data.saved);
        else setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="text-xs text-[var(--color-text-muted)]">
        {item.platform} · {item.author ? `${item.author} · ` : ''}
        {item.publishedAt ?? t('dailyDateUnknown')} · {t(`material_${item.materialKind}`)}
        {item.truncated ? ` · ${t('materialTruncated')}` : ''}
      </div>
      <h3 className="mt-2 font-semibold">{item.title}</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{item.excerpt}</p>
      {reason ? (
        <p className="mt-3 text-sm leading-6 text-[var(--color-accent)]">{reason}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--color-text-muted)]">
        {item.interestLabels.map(label => (
          <span key={`${label.interestId}:${label.revision}`}>
            {label.text}
            {label.historical ? ` (${t('historicalInterest')})` : ''}
          </span>
        ))}
      </div>
      <div className="mt-4 flex gap-3">
        <Button variant="secondary" disabled={busy} onClick={() => void act('open')}>
          {t('openContent')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void act('favorite')}>
          {t(saved ? 'unsaveContent' : 'saveContent')}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">
          {t('contentActionFailed')}
        </p>
      ) : null}
    </article>
  );
}
