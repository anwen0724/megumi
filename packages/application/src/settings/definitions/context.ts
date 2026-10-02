/* Defines the configured automatic context compaction threshold. */
import { z } from 'zod';

export const ContextConfigurationSchema = z.object({
  compactionThresholdRatio: z.number().gt(0).lt(1).default(0.8),
}).default({});
