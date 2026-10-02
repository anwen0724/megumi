/* Defines general application preferences and first-run completion. */
import { z } from 'zod';

export const GeneralSettingsSchema = z.object({
  language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
  theme: z.enum([
    'megumi-warm', 'neutral-light', 'sunlit-sky', 'rose-moon',
    'verdant-cloud', 'cangming-blue', 'frost-cyan', 'cyan-tide', 'midnight-blue',
  ]).default('midnight-blue'),
  setupCompleted: z.boolean().default(false),
}).default({});
