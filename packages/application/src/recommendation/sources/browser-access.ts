/* Owns the browser access responsibility of the Recommendation product. */

export type EmbeddedBrowserProfileId = 'zhihu' | 'bilibili' | 'xiaohongshu' | 'douyin';

export interface EmbeddedBrowserLink {
  readonly href: string;
  readonly text: string;
  readonly contextText?: string;
  readonly imageUrl?: string;
}

export interface EmbeddedBrowserSnapshot {
  readonly finalUrl: string;
  readonly title?: string;
  readonly bodyText: string;
  readonly truncated?: boolean;
  readonly structuredData?: unknown;
  readonly responses?: readonly { url: string; status: number; body: string }[];
  readonly completed?: boolean;
  readonly pageState?: 'available' | 'login_required' | 'challenge_required';
  readonly links: readonly EmbeddedBrowserLink[];
  /** Rendered content cards whose navigation is implemented without an anchor. */
  readonly cards?: readonly {
    readonly id: string;
    readonly title: string;
    readonly contextText?: string;
    readonly imageUrl?: string;
  }[];
}

export type EmbeddedBrowserFailure = {
  readonly code: 'timeout' | 'network_error' | 'invalid_response' | 'material_too_large' | 'cancelled';
  readonly message: string;
};

export type EmbeddedBrowserSnapshotResult =
  | { readonly status: 'success'; readonly snapshot: EmbeddedBrowserSnapshot; }
  | { readonly status: 'failed'; readonly failure: EmbeddedBrowserFailure; };

export interface EmbeddedBrowser {
  /** Executes a bundled fixed reader; no caller-provided JavaScript is accepted. */
  readPlatform(request: {
    profileId: 'zhihu' | 'bilibili' | 'xiaohongshu';
    operation: 'search' | 'detail' | 'status';
    url: string;
    signal: AbortSignal;
  }): Promise<EmbeddedBrowserSnapshotResult>;
  /** Uses a platform session for fixed API endpoints and subtitle reads. */
  fetchWithSession(request: { profileId: 'bilibili'; url: string; signal?: AbortSignal }): Promise<Response>;
  /** Opens the isolated persistent profile for an interactive Source login. */
  openLogin(request: {
    readonly profileId: EmbeddedBrowserProfileId;
    readonly url: string;
    readonly allowedOrigins: readonly string[];
  }): Promise<{ closed: Promise<void> }>;
  /** Navigates an isolated profile and returns a script-free page snapshot. */
  snapshot(request: {
    readonly profileId: EmbeddedBrowserProfileId;
    readonly url: string;
    readonly allowedOrigins: readonly string[];
    readonly signal: AbortSignal;
  }): Promise<EmbeddedBrowserSnapshotResult>;
  /** Closes browser profiles and releases Host resources. */
  shutdown(): Promise<void>;
}
