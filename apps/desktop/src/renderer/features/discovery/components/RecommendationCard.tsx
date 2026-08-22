/* Renders one persisted Recommendation snapshot and its user-controlled state. */
import { Bookmark, Clock3, EyeOff, Heart, MessageCircle, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DiscoveryRecommendationUiDto } from '@megumi/product/host';
import { cx } from '../../../shared/ui';

type RecommendationAction =
  | { action: 'opened' }
  | { action: 'set_reaction'; reaction: 'liked' | 'disliked' | null }
  | { action: 'set_hidden'; hidden: boolean }
  | { action: 'set_favorite'; favorite: boolean }
  | { action: 'set_watch_later'; watchLater: boolean };

interface RecommendationCardProps {
  recommendation: DiscoveryRecommendationUiDto;
  onAction(action: RecommendationAction): void;
  onChat?(): void;
}

export function RecommendationCard({ recommendation, onAction, onChat }: RecommendationCardProps) {
  const { t, i18n } = useTranslation('discovery');
  const sourceMeta = [
    recommendation.author,
    recommendation.contentPublishedAt ? formatContentDate(recommendation.contentPublishedAt, i18n.language) : undefined,
  ].filter(Boolean).join(' · ');

  const openOriginal = () => {
    onAction({ action: 'opened' });
    window.open(recommendation.canonicalUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <article
      data-testid={`recommendation-${recommendation.recommendationId}`}
      className="group flex min-w-0 flex-col overflow-hidden rounded-[1.35rem] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_1px_0_rgba(0,0,0,0.02),0_14px_35px_rgba(32,27,18,0.055)] transition duration-300 hover:-translate-y-0.5 hover:border-[var(--color-accent)]/45 hover:shadow-[0_20px_45px_rgba(32,27,18,0.09)]"
    >
      <button
        type="button"
        aria-label={t('openOriginal', { title: recommendation.title })}
        onClick={openOriginal}
        className="relative block aspect-[16/9] w-full overflow-hidden bg-[var(--color-surface-muted)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus)]"
      >
        {recommendation.coverUrl ? (
          <img
            src={recommendation.coverUrl}
            alt=""
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]"
          />
        ) : (
          <span className="flex h-full items-end bg-[radial-gradient(circle_at_82%_18%,var(--color-accent-soft),transparent_42%),linear-gradient(145deg,var(--color-surface-muted),var(--color-surface))] p-5 text-[clamp(1.2rem,2.2vw,1.9rem)] font-semibold leading-tight tracking-[-0.035em] text-[var(--color-text)]">
            {recommendation.title}
          </span>
        )}
        <span className="absolute right-3 top-3 rounded-full border border-white/20 bg-black/70 px-2.5 py-1 text-[0.68rem] font-semibold tracking-wide text-white backdrop-blur-sm">
          {recommendation.sourceName}
        </span>
      </button>

      <div className="flex flex-1 flex-col p-4.5">
        <button type="button" onClick={openOriginal} className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]">
          <h3 className="line-clamp-2 text-[1.05rem] font-semibold leading-[1.35] tracking-[-0.018em] text-[var(--color-text)] group-hover:text-[var(--color-accent)]">
            {recommendation.title}
          </h3>
        </button>
        {sourceMeta ? <p className="mt-1.5 truncate text-xs text-[var(--color-text-muted)]">{sourceMeta}</p> : null}
        {recommendation.description ? (
          <p className="mt-3 line-clamp-3 text-sm leading-6 text-[var(--color-text-muted)]">{recommendation.description}</p>
        ) : null}
        <div className="mt-4 rounded-xl bg-[var(--color-surface-muted)] px-3.5 py-3">
          <p className="mb-1 text-[0.66rem] font-semibold uppercase tracking-[0.13em] text-[var(--color-text-subtle)]">
            {t('recommendationReason')}
          </p>
          <p className="line-clamp-3 text-sm leading-5 text-[var(--color-text)]">{recommendation.recommendationReason}</p>
        </div>

        <div className="mt-auto flex items-center gap-1 pt-4">
          <CardAction
            label={t('like', { title: recommendation.title })}
            active={recommendation.reaction === 'liked'}
            onClick={() => onAction({ action: 'set_reaction', reaction: recommendation.reaction === 'liked' ? null : 'liked' })}
          ><ThumbsUp size={15} /></CardAction>
          <CardAction
            label={t('dislike', { title: recommendation.title })}
            active={recommendation.reaction === 'disliked'}
            onClick={() => onAction({ action: 'set_reaction', reaction: recommendation.reaction === 'disliked' ? null : 'disliked' })}
          ><ThumbsDown size={15} /></CardAction>
          <CardAction label={t('hide', { title: recommendation.title })} onClick={() => onAction({ action: 'set_hidden', hidden: true })}>
            <EyeOff size={15} />
          </CardAction>
          <CardAction
            label={t(recommendation.watchLater ? 'removeLater' : 'saveLater', { title: recommendation.title })}
            active={recommendation.watchLater}
            onClick={() => onAction({ action: 'set_watch_later', watchLater: !recommendation.watchLater })}
          ><Clock3 size={15} /></CardAction>
          <CardAction
            label={t(recommendation.favorite ? 'unfavorite' : 'favorite', { title: recommendation.title })}
            active={recommendation.favorite}
            onClick={() => onAction({ action: 'set_favorite', favorite: !recommendation.favorite })}
          ><Heart size={15} className={recommendation.favorite ? 'fill-current' : undefined} /></CardAction>
          <button
            type="button"
            aria-label={t('chatAbout', { title: recommendation.title })}
            onClick={onChat}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--color-accent)] px-3 text-xs font-semibold text-[var(--color-accent-foreground)] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
          >
            <MessageCircle size={14} aria-hidden="true" />
            {t('chat')}
          </button>
        </div>
      </div>
    </article>
  );
}

function CardAction({ label, active = false, onClick, children }: {
  label: string;
  active?: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 w-8 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]',
        active
          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          : 'text-[var(--color-text-subtle)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]',
      )}
    >
      {children}
    </button>
  );
}

function formatContentDate(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }).format(new Date(value));
}
