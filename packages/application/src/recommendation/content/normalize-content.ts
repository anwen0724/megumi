/*
 * Turns one source discovery into normalized content: a canonical URL, plain
 * text that keeps paragraph, list, and code structure, and platform fields
 * mapped onto shared names. Quality filtering that needs the analysis result
 * stays in the analysis step.
 */
import type { RawItem } from '../sources/source-connector';

/** Query parameters that only carry tracking, campaign, or share context. */
const TRACKING_PARAMETERS = new Set([
  'ref',
  'refer',
  'referer',
  'referrer',
  'from',
  'source',
  'spm',
  'share_token',
  'share_source',
  'share_medium',
  'share_plat',
  'share_session_id',
  's_r',
  's_t',
  's_u',
  'scene',
  'src',
]);

export interface NormalizedContent {
  readonly source: string;
  readonly canonicalUrl: string;
  readonly title?: string;
  readonly author?: string;
  /** Source-declared publication time in UTC milliseconds. */
  readonly publishedAt?: number;
  readonly text: string;
  readonly language?: string;
}

export type NormalizeRejection = 'invalid_url' | 'no_text' | 'language';

export type NormalizeResult =
  | { status: 'ok'; content: NormalizedContent }
  | { status: 'rejected'; reason: NormalizeRejection; message: string };

export interface NormalizeOptions {
  /** Configured accepted languages; empty means no restriction. */
  readonly contentLanguages?: readonly string[];
}

/**
 * Canonicalizes a URL for identity: drops the fragment and tracking
 * parameters, lowercases the host, removes default ports, and orders the
 * remaining parameters so two spellings of one URL compare equal. Parameters
 * that may change the content are kept.
 */
export function normalizeContentUrl(rawUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (!url.hostname) return undefined;

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }

  const kept = [...url.searchParams.entries()]
    .filter(([name]) => !isTrackingParameter(name))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  url.search = '';
  for (const [name, value] of kept) url.searchParams.append(name, value);

  return url.toString();
}

/** Converts source HTML into text that keeps paragraph, list, and code structure. */
export function htmlToPlainText(input: string): string {
  if (!input) return '';
  if (!input.includes('<')) return collapse(input);

  const codeBlocks: string[] = [];
  // Code keeps its own whitespace, so it leaves the line collapsing path.
  const withoutCode = input.replace(
    /<(pre|code)\b[^>]*>([\s\S]*?)<\/\1\s*>/giu,
    (_match, _tag: string, inner: string) => {
      codeBlocks.push(decodeEntities(stripTags(inner)).replace(/^\n+|\n+$/gu, ''));
      return `\u0000code${codeBlocks.length - 1}\u0000`;
    },
  );

  const withBreaks = withoutCode
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<li\b[^>]*>/giu, '\n- ')
    .replace(/<\/(ul|ol)\s*>/giu, '\n\n')
    .replace(/<\/(p|div|tr|h[1-6]|blockquote|section|article)\s*>/giu, '\n');

  // Collapse first and restore code afterwards, so its indentation survives.
  const collapsed = collapse(decodeEntities(stripTags(withBreaks)));
  return collapsed
    .replace(
      /\u0000code(\d+)\u0000/gu,
      (_match, index: string) => `\n${codeBlocks[Number(index)] ?? ''}\n`,
    )
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/**
 * Detects the dominant script of a text. Returns undefined when the sample is
 * too small or mixed to judge, so callers never treat "unknown" as "mismatch".
 */
export function detectContentLanguage(text: string): string | undefined {
  const sample = text.slice(0, 2_000);
  const cjk = (sample.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu) ?? []).length;
  const hangul = (sample.match(/[\uac00-\ud7af]/gu) ?? []).length;
  const latin = (sample.match(/[A-Za-z]/gu) ?? []).length;
  const total = cjk + hangul + latin;
  if (total < 20) return undefined;

  if (cjk + hangul >= total * 0.5) {
    if (hangul > cjk) return 'ko';
    if (/[\u3040-\u30ff]/u.test(sample) && cjk > 0 && (sample.match(/[\u3040-\u30ff]/gu) ?? []).length > cjk * 0.2) {
      return 'ja';
    }
    return 'zh';
  }
  return latin >= total * 0.5 ? 'en' : undefined;
}

/**
 * Maps one discovery onto normalized content. Entries without usable text are
 * rejected here: they stay as discovery records and never reach analysis.
 */
export function normalizeRawItem(item: RawItem, options: NormalizeOptions = {}): NormalizeResult {
  const canonicalUrl = normalizeContentUrl(item.url);
  if (!canonicalUrl) {
    return { status: 'rejected', reason: 'invalid_url', message: `Unusable source URL: ${item.url}` };
  }

  const text = htmlToPlainText(item.text ?? '');
  if (!text) {
    return {
      status: 'rejected',
      reason: 'no_text',
      message: 'Source returned no usable content text.',
    };
  }

  const language = detectContentLanguage(text);
  const allowed = options.contentLanguages ?? [];
  if (allowed.length > 0 && language !== undefined && !allowed.includes(language)) {
    return {
      status: 'rejected',
      reason: 'language',
      message: `Content language ${language} is not in the configured set.`,
    };
  }

  const title = item.title?.trim();
  const author = item.author?.trim();
  return {
    status: 'ok',
    content: {
      source: item.source,
      canonicalUrl,
      ...(title ? { title } : {}),
      ...(author ? { author } : {}),
      ...(item.publishedAt !== undefined ? { publishedAt: item.publishedAt } : {}),
      text,
      ...(language ? { language } : {}),
    },
  };
}

function isTrackingParameter(name: string): boolean {
  const key = name.trim().toLowerCase();
  return key.startsWith('utm_') || TRACKING_PARAMETERS.has(key);
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/gu, '');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, ' ')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#x([0-9a-f]+);/giu, (_match, code: string) => codePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/gu, (_match, code: string) => codePoint(Number.parseInt(code, 10)))
    .replace(/&amp;/giu, '&');
}

function codePoint(value: number): string {
  return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
}

/** Collapses horizontal whitespace and excessive blank lines without losing paragraphs. */
function collapse(value: string): string {
  return value
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0\u3000]+/gu, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}
