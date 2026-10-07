/*
 * Defines the platform-neutral source contract. `search` returns discoveries
 * and `fetch` completes material on demand; authentication, paging, and field
 * mapping stay inside each connector, while downstream code uses one shared
 * content and analysis model.
 */

import { z } from 'zod';
import { PublicationEvidenceSchema } from '../content/material-contracts';

/** Validates saved source facts before a later round consumes them. */
export const RawItemSchema = z.object({
  source: z.string().min(1),
  externalId: z.string().optional(),
  serviceRecordId: z.string().optional(),
  url: z.string().url(),
  title: z.string().optional(),
  text: z.string().optional(),
  author: z.string().optional(),
  publishedAt: z.number().int().nonnegative().optional(),
  platform: z.enum(['web', 'zhihu', 'bilibili', 'xiaohongshu']).optional(),
  method: z.string().optional(),
  kind: z.enum(['full_text', 'excerpt', 'description', 'transcript']).optional(),
  truncated: z.boolean().optional(),
  rangeStart: z.number().int().nonnegative().optional(),
  rangeEnd: z.number().int().nonnegative().optional(),
  publicationEvidence: z.array(PublicationEvidenceSchema).readonly().optional(),
  // Access parameters remain local; models and logs receive the canonical URL.
  requestUrl: z.string().url().optional(),
  authorId: z.string().optional(),
  acquiredAt: z.number().int().nonnegative().optional(),
}).strict();
export type RawItem = z.infer<typeof RawItemSchema>;

/** Failure kinds callers map to retry, cooldown, or a reported gap. */
export type SourceFailureCode =
  | 'not_configured'
  | 'unauthorized'
  | 'rate_limited'
  | 'unavailable'
  | 'unsupported'
  | 'material_unavailable'
  | 'invalid_response'
  | 'network_error'
  | 'login_required'
  | 'challenge_required'
  | 'timeout'
  | 'material_too_large'
  | 'budget_exhausted'
  | 'cancelled';

export interface SourceFailure {
  readonly code: SourceFailureCode;
  readonly message: string;
  /** True when retrying within the round budget may succeed. */
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
}

export interface SourceSearchRequest {
  /** Reserves each logical service attempt; physical transport retries use reserveRequest. */
  readonly reserveSearch?: (sourceId: string) => boolean;
  /** Reserves each actual request before sending; false stops work without fallback. */
  readonly reserveRequest?: (kind: 'search' | 'material') => boolean;
  readonly query: string;
  readonly limit: number;
  /** Inclusive UTC-millisecond window; the source applies its own filtering. */
  readonly timeRange?: { readonly from?: number; readonly to?: number };
  readonly signal?: AbortSignal;
}

export type SourceSearchResult =
  | { status: 'success'; items: readonly RawItem[] }
  | { status: 'failed'; failure: SourceFailure };

export interface SourceMaterialRequest {
  readonly reserveRequest?: (kind: 'search' | 'material') => boolean;
  readonly url: string;
  /** Platform fields the caller already knows from search. */
  readonly externalId?: string;
  readonly signal?: AbortSignal;
}

export interface SourceMaterial extends Omit<RawItem, 'url' | 'externalId' | 'source'> {
  readonly text: string;
}

export type SourceMaterialResult =
  | { status: 'success'; material: SourceMaterial }
  | { status: 'failed'; failure: SourceFailure };

/**
 * What one source can do. The program uses it to fill search parameters and
 * decide whether material can be completed; the planner uses it to choose a
 * source. Connector code provides it, never user configuration or the model.
 */
export interface SourceDescriptor {
  /** Matches the value used in `enabledSources`. */
  readonly id: string;
  /** Planner-facing description: content types, main language, useful directions. */
  readonly description: string;
  readonly accessPaths: readonly ('credential' | 'browser_session' | 'public')[];
  /** Most items one search can return. */
  readonly maxResultsPerSearch: number;
  /** Whether the source accepts a date window; its date evidence still requires judgment. */
  readonly supportsTimeRange: boolean;
  /** Text a search response already carries. */
  readonly material: 'full_text' | 'excerpt' | 'none';
  /** Whether material can be completed on demand. */
  readonly supportsFetch: boolean;
}

/** One platform's search and material access behind a stable contract. */
export interface SourceConnector {
  /** This connector charges actual requests rather than one logical operation. */
  readonly managesRequestBudget?: true;
  readonly id: string;
  readonly descriptor: SourceDescriptor;
  search(request: SourceSearchRequest): Promise<SourceSearchResult>;
  fetch(request: SourceMaterialRequest): Promise<SourceMaterialResult>;
}
