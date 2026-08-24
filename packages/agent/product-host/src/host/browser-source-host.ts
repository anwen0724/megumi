/* Defines renderer-safe Host views for the local Chromium extension connection. */
import { z } from 'zod';

export const BrowserSourceConnectionViewSchema = z.object({
  state: z.enum(['ready', 'extension_offline', 'not_configured', 'not_supported']),
  port: z.number().int().min(1).max(65_535).optional(),
  checkedAt: z.string().datetime({ offset: true }).optional(),
}).strict();
export const BrowserSourcePairingViewSchema = z.object({
  code: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
  port: z.number().int().min(1).max(65_535),
}).strict();
export const BrowserSourceEmptyRequestSchema = z.object({}).strict();

export type BrowserSourceConnectionView = z.infer<typeof BrowserSourceConnectionViewSchema>;
export type BrowserSourcePairingView = z.infer<typeof BrowserSourcePairingViewSchema>;

export interface BrowserSourceConnectionAdapter {
  getConnection(): BrowserSourceConnectionView;
  beginPairing(): BrowserSourcePairingView;
  revokeConnection(): BrowserSourceConnectionView;
}

export interface BrowserSourceHost {
  getConnection(): Promise<BrowserSourceConnectionView>;
  beginPairing(): Promise<BrowserSourcePairingView>;
  revokeConnection(): Promise<BrowserSourceConnectionView>;
}
