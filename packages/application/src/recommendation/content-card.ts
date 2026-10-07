/*
 * Builds one renderer-safe card from the exact saved material and result snapshots.
 */
import type { ContentMaterial } from './content/material-contracts';
import { publicationInterval } from './daily-calendar';
import type { ContentCard } from './feed-contracts';
/** Unknown facts stay absent; the excerpt always describes the pinned material. */
export function contentCard(material: ContentMaterial, input: {
  saved: boolean;
  interestLabels: ContentCard['interestLabels'];
  title?: string;
  excerpt?: string;
}): ContentCard {
  const publication = publicationInterval(material);
  return {
    contentId: material.contentId, materialId: material.id, platform: material.platform,
    title: input.title ?? material.title ?? material.canonicalUrl, url: material.canonicalUrl, author: material.author,
    excerpt: input.excerpt ?? [...material.text].slice(0, 500).join(''), materialKind: material.kind, truncated: material.truncated,
    publicationPrecision: publication?.precision ?? 'unknown',
    ...(publication ? { publishedAt: publication.precision === 'date' ? String(publication.evidence.value) : new Date(publication.start).toISOString() } : {}),
    interestLabels: input.interestLabels, saved: input.saved,
  };
}
