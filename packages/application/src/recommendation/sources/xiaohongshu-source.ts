/* Reads Xiaohongshu search responses and note detail through its isolated session. */
import type { EmbeddedBrowser } from './browser-access';
import type { SourceConnector } from './source-connector';
import { sourceFailure } from './source-http';
import { z } from 'zod';
import { boundedMaterial, identifyContentUrl, publicationClaim } from './source-material';

const SearchResponseSchema = z.object({
  code: z.number(),
  success: z.boolean().optional(),
  data: z.object({
    items: z.array(z.object({
      id: z.string(),
      model_type: z.string().optional(),
      xsec_token: z.string().optional(),
      note_card: z.object({
        display_title: z.string().optional(),
        title: z.string().optional(),
        desc: z.string().optional(),
        user: z.object({ nickname: z.string().optional(), user_id: z.string().optional() }).optional()
      }).optional(),
    })), has_more: z.boolean().optional()
  }).optional()
});
const NoteSchema = z.object({
  note: z.object({
    noteId: z.string(),
    title: z.string().optional(),
    desc: z.string().optional(),
    time: z.number().nonnegative().optional(),
    lastUpdateTime: z.number().nonnegative().optional(),
    user: z.object({ nickname: z.string().optional(), userId: z.string().optional() }).optional()
  })
});

export function createXiaohongshuSource(options: { browser?: EmbeddedBrowser }): SourceConnector {
  return {
    managesRequestBudget: true,
    id: 'xiaohongshu',
    descriptor: {
      id: 'xiaohongshu',
      description: '小红书笔记正文。',
      accessPaths: ['browser_session'],
      maxResultsPerSearch: 20,
      supportsTimeRange: false,
      material: 'excerpt',
      supportsFetch: true
    },
    async search(request) {
      if (request.signal?.aborted) return sourceFailure('cancelled', 'Xiaohongshu search was cancelled.');
      if (!options.browser) return sourceFailure('login_required', 'Xiaohongshu session is unavailable.');
      if (request.reserveRequest && !request.reserveRequest('search')) return sourceFailure('budget_exhausted', 'Source request budget was exhausted.');
      const url = new URL('https://www.xiaohongshu.com/search_result');
      url.searchParams.set('keyword', request.query);
      const result = await options.browser.readPlatform({
        profileId: 'xiaohongshu',
        operation: 'search',
        url: url.href,
        signal: request.signal ?? new AbortController().signal
      });
      if (result.status === 'failed') return sourceFailure(result.failure.code, result.failure.message);
      const page = result.snapshot;
      if (page.pageState === 'login_required' || page.pageState === 'challenge_required') return sourceFailure(page.pageState, 'Xiaohongshu requires user verification.');
      for (const response of page.responses ?? []) {
        if (response.status === 401 || response.status === 403) return sourceFailure('login_required', 'Xiaohongshu session expired.');
        if (response.status === 412) return sourceFailure('challenge_required', 'Xiaohongshu requires verification.', 30 * 60_000);
        if (response.status === 429) return sourceFailure('rate_limited', 'Xiaohongshu rate limited the request.', 5 * 60_000);
        if (response.status !== 200) return sourceFailure('unavailable', 'Xiaohongshu search request failed.');
        let payload: unknown;
        try { payload = JSON.parse(response.body); } catch { return sourceFailure('invalid_response', 'Xiaohongshu search was not JSON.'); }
        const parsed = SearchResponseSchema.safeParse(payload);
        if (!parsed.success) return sourceFailure('invalid_response', 'Xiaohongshu search format changed.');
        if (parsed.data.code !== 0 || parsed.data.success === false) return sourceFailure('invalid_response', 'Xiaohongshu rejected the search request.');
        if (!parsed.data.data) return sourceFailure('invalid_response', 'Xiaohongshu returned no search payload.');
        const items = parsed.data.data.items.filter((entry) => entry.note_card && (!entry.model_type || entry.model_type === 'note')).slice(
          0,
          request.limit
        ).map((entry) => {
          const card = entry.note_card!;
          const detailUrl = new URL(`https://www.xiaohongshu.com/explore/${encodeURIComponent(entry.id)}`);
          if (entry.xsec_token) { detailUrl.searchParams.set('xsec_token', entry.xsec_token); detailUrl.searchParams.set('xsec_source', 'pc_search'); }
          return {
            source: 'xiaohongshu',
            platform: 'xiaohongshu' as const,
            externalId: entry.id,
            url: `https://www.xiaohongshu.com/explore/${encodeURIComponent(entry.id)}`,
            requestUrl: detailUrl.href,
            title: card.display_title ?? card.title,
            ...boundedMaterial(card.desc ?? ''),
            kind: 'excerpt' as const,
            method: 'xiaohongshu_search_response',
            author: card.user?.nickname,
            authorId: card.user?.user_id,
            publicationEvidence: []
          };
        });
        if (parsed.data.data.items.length && !items.length) return sourceFailure('invalid_response', 'Xiaohongshu returned entries without usable note identities.');
        return { status: 'success', items };
      }
      const items = page.links.flatMap((link) => {
        const identity = identifyContentUrl(link.href);
        return identity?.platform === 'xiaohongshu' ? [{
          ...identity,
          source: 'xiaohongshu',
          requestUrl: link.href,
          title: link.text,
          ...boundedMaterial(link.contextText ?? ''),
          kind: 'excerpt' as const,
          method: 'xiaohongshu_search_dom',
          publicationEvidence: []
        }] : [];
      }).slice(0, request.limit);
      return items.length || page.completed ? { status: 'success', items } : sourceFailure('timeout', 'Xiaohongshu did not establish results or an empty result.');
    },
    async fetch(request) {
      if (request.signal?.aborted) return sourceFailure('cancelled', 'Xiaohongshu detail was cancelled.');
      if (!options.browser) return sourceFailure('login_required', 'Xiaohongshu session is unavailable.');
      const identity = identifyContentUrl(request.url);
      if (!identity || identity.platform !== 'xiaohongshu') return sourceFailure('invalid_response', 'URL does not identify a Xiaohongshu note.');
      if (request.reserveRequest && !request.reserveRequest('material')) return sourceFailure('budget_exhausted', 'Source request budget was exhausted.');
      const result = await options.browser.readPlatform({
        profileId: 'xiaohongshu',
        operation: 'detail',
        url: request.url,
        signal: request.signal ?? new AbortController().signal
      });
      if (result.status === 'failed') return sourceFailure(result.failure.code, result.failure.message);
      const page = result.snapshot;
      if (page.pageState === 'login_required' || page.pageState === 'challenge_required') return sourceFailure(page.pageState, 'Xiaohongshu requires user verification.');
      const parsed = NoteSchema.safeParse(page.structuredData);
      if (parsed.success && parsed.data.note.noteId !== identity.externalId) return sourceFailure('invalid_response', 'Xiaohongshu returned another note.');
      const note = parsed.success ? parsed.data.note : undefined;
      const text = note?.desc?.trim() || page.bodyText.trim();
      if (!text) return sourceFailure('material_unavailable', 'Xiaohongshu returned no note body.');
      const body = boundedMaterial(text);
      return {
        status: 'success', material: {
          ...body,
          truncated: page.truncated === true || body.truncated,
          platform: 'xiaohongshu',
          kind: 'full_text',
          method: note ? 'xiaohongshu_note_state' : 'xiaohongshu_note_dom',
          title: note?.title,
          author: note?.user?.nickname,
          authorId: note?.user?.userId,
          publishedAt: note?.time,
          publicationEvidence: [
            ...(note?.time === undefined ? [] : [publicationClaim(note.time, 'Xiaohongshu.note.time', 'published', true)]),
            ...(note?.lastUpdateTime === undefined ? [] : [publicationClaim(note.lastUpdateTime, 'Xiaohongshu.note.lastUpdateTime', 'modified')]),
          ],
        }
      };
    },
  };
}
