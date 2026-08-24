/* Materializes a persisted Recommendation reference into deterministic model text. */
import type { TextContent } from '@megumi/ai';
import type { RecommendationReferenceContent } from '@megumi/session';

function escapeMarkup(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Produces the stable model-visible representation used both now and after reload. */
export function materializeRecommendationReference(
  reference: RecommendationReferenceContent,
): TextContent {
  const lines = [
    `<recommended_content id="${escapeMarkup(reference.recommendationId)}" source="${escapeMarkup(reference.sourceName)}" url="${escapeMarkup(reference.canonicalUrl)}">`,
    `<title>${escapeMarkup(reference.title)}</title>`,
    ...(reference.author ? [`<author>${escapeMarkup(reference.author)}</author>`] : []),
    ...(reference.publishedAt ? [`<published_at>${escapeMarkup(reference.publishedAt)}</published_at>`] : []),
    ...(reference.description ? [`<description>${escapeMarkup(reference.description)}</description>`] : []),
    `<recommendation_reason>${escapeMarkup(reference.recommendationReason)}</recommendation_reason>`,
    '</recommended_content>',
  ];
  return { type: 'text', text: lines.join('\n') };
}
