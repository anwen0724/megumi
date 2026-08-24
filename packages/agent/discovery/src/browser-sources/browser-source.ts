/* Adapts one strict browser task into a normalized DiscoverySource. */
import { SourceContentSchema, type DiscoverySource, type SourceAvailability, type SourceFailure } from '../sources/discovery-source';
import type { BrowserSourceId, BrowserSourceTaskGateway } from './browser-source-contracts';

export function createBrowserSource(input: {
  readonly sourceId: BrowserSourceId;
  readonly name: string;
  readonly gateway: BrowserSourceTaskGateway;
}): DiscoverySource {
  let platformAvailability: SourceAvailability = { state: 'unknown' };

  return {
    descriptor: { id: input.sourceId, name: input.name, access: 'browser_session', supportedModes: ['relevance'] },
    getAvailability() {
      const connection = input.gateway.getConnectionState();
      if (connection.state === 'extension_offline') return { state: 'extension_offline', ...(connection.checkedAt ? { checkedAt: connection.checkedAt } : {}) };
      if (connection.state === 'not_configured') return { state: 'not_configured' };
      return platformAvailability;
    },
    async search(request) {
      if (request.mode !== 'relevance') {
        return failed('invalid_response', `${input.name} does not support recent search.`, false);
      }
      const result = await input.gateway.execute({
        sourceId: input.sourceId,
        operation: 'search',
        query: request.query.trim(),
        mode: request.mode,
        limit: request.limit,
      }, { signal: request.signal });
      const checkedAt = new Date().toISOString();
      if (result.status === 'failed') {
        platformAvailability = failureAvailability(result.failure.code, checkedAt);
        return failed(
          result.failure.code,
          result.failure.message,
          result.failure.code === 'timeout' || result.failure.code === 'network_error',
        );
      }
      platformAvailability = { state: 'ready', checkedAt };
      try {
        return {
          status: 'success',
          items: result.items.map((item) => SourceContentSchema.parse({
            sourceId: input.sourceId,
            sourceName: input.name,
            sourceContentId: item.sourceContentId,
            canonicalUrl: item.url,
            contentType: item.contentType,
            title: item.title,
            ...(item.author ? { author: item.author } : {}),
            ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
            ...(item.description ? { description: item.description } : {}),
            ...(item.coverUrl ? { coverUrl: item.coverUrl } : {}),
          })),
        };
      } catch {
        platformAvailability = { state: 'unknown', checkedAt };
        return failed('invalid_response', `${input.name} returned invalid content facts.`, false);
      }
    },
  };
}

function failureAvailability(code: string, checkedAt: string): SourceAvailability {
  if (code === 'login_required') return { state: 'login_required', checkedAt };
  if (code === 'risk_control') return { state: 'risk_controlled', checkedAt };
  if (code === 'extension_offline') return { state: 'extension_offline', checkedAt };
  return { state: 'unknown', checkedAt };
}

function failed(code: SourceFailure['code'], message: string, retryable: boolean) {
  return { status: 'failed' as const, failure: { code, message, retryable } };
}
