/* Defines renderer-safe source identity, access state and login results. */
import { z } from 'zod';

export const SourceIdSchema = z.enum(['tavily', 'bing_rss', 'zhihu', 'bilibili', 'xiaohongshu']);
export type SourceId = z.infer<typeof SourceIdSchema>;
export const SOURCE_CATALOG = [
  { sourceId: 'tavily', name: 'Tavily' },
  { sourceId: 'bing_rss', name: 'Bing RSS' },
  { sourceId: 'zhihu', name: '知乎' },
  { sourceId: 'bilibili', name: 'B 站' },
  { sourceId: 'xiaohongshu', name: '小红书' },
] as const;
export const SourceAccessViewSchema = z.object({
  sourceId: SourceIdSchema,
  state: z.enum([
    'disabled',
    'not_configured',
    'unchecked',
    'available',
    'login_required',
    'challenge_required',
    'cooling_down',
    'unavailable'
  ]),
  checkedAt: z.string().datetime().nullable(),
  retryAt: z.string().datetime().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
}).strict();
export type SourceAccessView = z.infer<typeof SourceAccessViewSchema>;
export const SourceLoginResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('opened') }).strict(),
  z.object({ status: z.literal('rejected'), error: z.object({ code: z.enum(['SOURCE_NOT_CONFIGURED', 'SOURCE_UNAVAILABLE', 'UNSUPPORTED_OPERATION']), message: z.string() }).strict() }).strict(),
]);
export type SourceLoginResult = z.infer<typeof SourceLoginResultSchema>;
