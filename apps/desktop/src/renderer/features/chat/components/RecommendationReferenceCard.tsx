/* Renders the immutable Recommendation snapshot that anchors a conversation. */
import { ExternalLink } from 'lucide-react';

export interface RecommendationReferenceCardData {
  recommendationId: string;
  sourceName: string;
  canonicalUrl: string;
  title: string;
  author?: string;
  publishedAt?: string;
  description?: string;
  coverUrl?: string;
  recommendationReason: string;
}

export function RecommendationReferenceCard({ reference }: {
  reference: RecommendationReferenceCardData;
}) {
  const metadata = [reference.author, reference.publishedAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(reference.publishedAt))
    : undefined].filter(Boolean).join(' · ');
  return (
    <article
      data-testid={`conversation-recommendation-${reference.recommendationId}`}
      className="mb-4 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-left shadow-sm"
    >
      <div className="flex min-w-0 gap-4 p-4">
        {reference.coverUrl ? (
          <img src={reference.coverUrl} alt="" className="h-24 w-36 shrink-0 rounded-xl object-cover" />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-[var(--color-accent)]">{reference.sourceName}</span>
            <a
              href={reference.canonicalUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${reference.title}`}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
            ><ExternalLink size={15} aria-hidden="true" /></a>
          </div>
          <h2 className="mt-1 line-clamp-2 font-semibold leading-snug text-[var(--color-text)]">{reference.title}</h2>
          {metadata ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">{metadata}</p> : null}
          {reference.description ? <p className="mt-2 line-clamp-2 text-sm leading-5 text-[var(--color-text-muted)]">{reference.description}</p> : null}
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--color-text-subtle)]">{reference.recommendationReason}</p>
        </div>
      </div>
    </article>
  );
}
