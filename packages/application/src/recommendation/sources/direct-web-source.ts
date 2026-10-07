/* Acquires public pages through the existing protected WebFetch boundary. */
import { createWebFetch, type WebFetch } from '@megumi/agent';
import { ToolExecutionFailure } from '@megumi/agent/tools/tool-result';
import { z } from 'zod';
import type { SourceConnector, SourceMaterialRequest, SourceMaterialResult } from './source-connector';
import { htmlToPlainText } from '../content/normalize-content';
import { publicationClaim } from './source-material';
import { sourceFailure, retrySourceRequest } from './source-http';

const PageMetadataSchema = z.object({
  '@type': z.union([z.string(), z.array(z.string())]),
  datePublished: z.string().optional(),
  dateModified: z.string().optional(),
  author: z.union([z.string(), z.object({ name: z.string().optional() })]).optional(),
}).passthrough();

export function createDirectWebSource(options: { webFetch?: WebFetch } = {}): SourceConnector {
  const web = options.webFetch ?? createWebFetch({
    timeoutMs: 30_000,
    maxResponseBytes: 2 * 1024 * 1024,
    maxContentBytes: 200_000,
    includeDocument: true
  });
  async function acquireOnce(request: SourceMaterialRequest): Promise<SourceMaterialResult> {
    try {
      const reserve = request.reserveRequest;
      const page = await web.fetch({
        url: request.url,
        signal: request.signal,
        beforeRequest: reserve ? () => reserve('material') : undefined
      });
      const html = page.document ?? '';
      const container = /<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i.exec(html)?.[1];
      const text = container ? htmlToPlainText(container) : page.content;
      if (!container && /安全验证|访问验证|人机验证|captcha|verify you are human/i.test(`${page.title ?? ''} ${text}`)) return sourceFailure('challenge_required', 'Page requires verification.');
      if (!container && (/^(?:登录|sign in|login)(?:$|[\s_-])/i.test(page.title ?? '') || /登录后查看全文/.test(text))) return sourceFailure('login_required', 'Page requires login.');
      if (!text.trim()) return sourceFailure('material_unavailable', 'Page has no acquired text.');
      const metadata = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].flatMap((match) => {
        let value: unknown;
        try { value = JSON.parse(match[1]); } catch { return []; }
        const values = metadataEntries(value);
        return values.flatMap((entry) => {
          const parsed = PageMetadataSchema.safeParse(entry);
          return parsed.success && [parsed.data['@type']].flat().some((kind) => /Article$|BlogPosting$|VideoObject$/.test(kind)) ? [parsed.data] : [];
        });
      });
      const evidence = metadata.flatMap((entry) => [
        ...(entry.datePublished ? [publicationClaim(entry.datePublished, 'page.JSON-LD.datePublished', 'published', true)] : []),
        ...(entry.dateModified ? [publicationClaim(entry.dateModified, 'page.JSON-LD.dateModified', 'modified')] : []),
      ]);
      const author = metadata.map((entry) => typeof entry.author === 'string' ? entry.author : entry.author?.name).find(Boolean);
      const chars = [...text];
      return {
        status: 'success', material: {
          text: chars.slice(0, 50_000).join(''),
          ...(page.title ? { title: page.title } : {}),
          ...(author ? { author } : {}),
          method: 'direct_web',
          kind: container || page.contentType !== 'text/html' ? 'full_text' : 'excerpt',
          truncated: page.truncated || chars.length > 50_000,
          rangeStart: 0,
          rangeEnd: Math.min(chars.length, 50_000),
          publicationEvidence: evidence
        }
      };
    } catch (error) {
      if (request.signal?.aborted) return sourceFailure('cancelled', 'Page acquisition was cancelled.');
      if (error instanceof ToolExecutionFailure) {
        const reason = error.details?.reason;
        const status = error.details?.statusCode;
        if (status === 412) return sourceFailure('challenge_required', 'Public page requires verification.', 30 * 60_000);
        if (status === 429) return sourceFailure('rate_limited', 'Public page is rate limited.', 5 * 60_000);
        const code = reason === 'budget_exhausted' ? 'budget_exhausted' : reason === 'response_too_large' ? 'material_too_large' : reason === 'timeout' ? 'timeout' : reason === 'network_error' ? 'network_error' : typeof status === 'number' && status >= 500 ? 'unavailable' : status === 401 || status === 403 ? 'login_required' : 'material_unavailable';
        return sourceFailure(code, 'Public page could not be acquired.');
      }
      return sourceFailure('network_error', 'Public page acquisition failed.');
    }
  }

  return {
    managesRequestBudget: true,
    id: 'direct_web',
    descriptor: {
      id: 'direct_web',
      description: '公开网页正文及时间依据。',
      accessPaths: ['public'],
      maxResultsPerSearch: 0,
      supportsTimeRange: false,
      material: 'none',
      supportsFetch: true
    },
    async search() {
      return {
        status: 'failed', failure: {
          code: 'unsupported',
          message: 'Direct web access has no search operation.',
          retryable: false
        }
      };
    },
    fetch(request) { return retrySourceRequest(() => acquireOnce(request), request.signal); },
  };
}

function metadataEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(metadataEntries);
  const graph = z.object({ '@graph': z.array(z.unknown()) }).safeParse(value);
  return graph.success ? graph.data['@graph'].flatMap(metadataEntries) : [value];
}
