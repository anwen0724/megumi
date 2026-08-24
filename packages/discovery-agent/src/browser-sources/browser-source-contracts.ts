/* Defines the strict Host/extension protocol for read-only browser searches. */
import { z } from 'zod';

export const BrowserSourceIdSchema = z.enum(['xiaohongshu', 'douyin', 'zhihu']);
const BrowserSearchTaskShape = {
  operation: z.literal('search'),
  query: z.string().trim().min(1).max(200),
  mode: z.enum(['relevance', 'recent']),
  limit: z.number().int().min(1).max(20),
};

export const BrowserSourceTaskRequestSchema = z.discriminatedUnion('sourceId', [
  z.object({ sourceId: z.literal('xiaohongshu'), ...BrowserSearchTaskShape }).strict(),
  z.object({ sourceId: z.literal('douyin'), ...BrowserSearchTaskShape }).strict(),
  z.object({ sourceId: z.literal('zhihu'), ...BrowserSearchTaskShape }).strict(),
]);

export const BrowserSourceItemSchema = z.object({
  sourceContentId: z.string().trim().min(1),
  url: z.string().url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)),
  title: z.string().trim().min(1),
  author: z.string().trim().min(1).optional(),
  publishedAt: z.string().datetime({ offset: true }).optional(),
  description: z.string().trim().min(1).optional(),
  coverUrl: z.string().url().optional(),
  contentType: z.enum(['video', 'article', 'post', 'page']),
}).strict();

export const BrowserSourceTaskResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), items: z.array(BrowserSourceItemSchema).max(20) }).strict(),
  z.object({
    status: z.literal('failed'),
    failure: z.object({
      code: z.enum(['extension_offline', 'login_required', 'risk_control', 'timeout', 'network_error', 'invalid_response', 'cancelled']),
      message: z.string(),
    }).strict(),
  }).strict(),
]);

export type BrowserSourceId = z.infer<typeof BrowserSourceIdSchema>;
export type BrowserSourceTaskRequest = z.infer<typeof BrowserSourceTaskRequestSchema>;
export type BrowserSourceTaskResult = z.infer<typeof BrowserSourceTaskResultSchema>;
export type BrowserSourceItem = z.infer<typeof BrowserSourceItemSchema>;

export interface BrowserSourceTaskGateway {
  getConnectionState(): {
    readonly state: 'ready' | 'extension_offline' | 'not_configured';
    readonly checkedAt?: string;
  };
  execute(
    request: BrowserSourceTaskRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<BrowserSourceTaskResult>;
}
