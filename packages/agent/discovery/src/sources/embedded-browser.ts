/* Defines the Host-neutral, script-free browser capability used by browser-session Sources. */
export type EmbeddedBrowserProfileId = 'xiaohongshu' | 'douyin';

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
  readonly links: readonly EmbeddedBrowserLink[];
}

export type EmbeddedBrowserFailure = {
  readonly code: 'timeout' | 'network_error' | 'invalid_response' | 'cancelled';
  readonly message: string;
};

export type EmbeddedBrowserSnapshotResult =
  | { readonly status: 'success'; readonly snapshot: EmbeddedBrowserSnapshot }
  | { readonly status: 'failed'; readonly failure: EmbeddedBrowserFailure };

export interface EmbeddedBrowser {
  openLogin(request: {
    readonly profileId: EmbeddedBrowserProfileId;
    readonly url: string;
    readonly allowedOrigins: readonly string[];
  }): Promise<void>;
  snapshot(request: {
    readonly profileId: EmbeddedBrowserProfileId;
    readonly url: string;
    readonly allowedOrigins: readonly string[];
    readonly signal: AbortSignal;
  }): Promise<EmbeddedBrowserSnapshotResult>;
  shutdown(): Promise<void>;
}
