/*
 * Defines the platform-neutral source contract. `search` returns discoveries
 * and `fetch` completes material on demand; authentication, paging, and field
 * mapping stay inside each connector, while downstream code uses one shared
 * content and analysis model.
 */

/** One discovery as the source returned it, before normalization. */
export interface RawItem {
  readonly source: string;
  /** Platform content id, used only inside the connector's own identity scope. */
  readonly externalId?: string;
  readonly url: string;
  readonly title?: string;
  /**
   * Text the source already returned. It may be full content, a truncated
   * excerpt, or absent; normalization and analysis decide what it supports.
   */
  readonly text?: string;
  readonly author?: string;
  /** Source-declared publication time in UTC milliseconds. */
  readonly publishedAt?: number;
}

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
  | 'cancelled';

export interface SourceFailure {
  readonly code: SourceFailureCode;
  readonly message: string;
  /** True when retrying within the round budget may succeed. */
  readonly retryable: boolean;
}

export interface SourceSearchRequest {
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
  readonly url: string;
  /** Platform fields the caller already knows from search. */
  readonly externalId?: string;
  readonly signal?: AbortSignal;
}

export interface SourceMaterial {
  readonly text: string;
  readonly author?: string;
  readonly publishedAt?: number;
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
  /** Most items one search can return. */
  readonly maxResultsPerSearch: number;
  /** Whether the source filters by the same time it maps to `publishedAt`. */
  readonly supportsTimeRange: boolean;
  /** Text a search response already carries. */
  readonly material: 'full_text' | 'excerpt' | 'none';
  /** Whether material can be completed on demand. */
  readonly supportsFetch: boolean;
}

/** One platform's search and material access behind a stable contract. */
export interface SourceConnector {
  readonly id: string;
  readonly descriptor: SourceDescriptor;
  search(request: SourceSearchRequest): Promise<SourceSearchResult>;
  fetch(request: SourceMaterialRequest): Promise<SourceMaterialResult>;
}
