/* Defines context compaction and explicit instruction discovery budgets. */
import { z } from 'zod';

export const ContextConfigurationSchema = z
  .object({
    compactionThresholdRatio: z.number().gt(0).lt(1).default(0.8),
    instructionFallbackNames: z.array(z.string().min(1).refine(
      (name) => name.trim().length > 0 && !/[\\/:\0]/.test(name) && name !== '.' && name !== '..',
      'Use a file name without path segments.',
    )).transform((names) => [...new Set(names)]).default([]),
    instructionMaxBytes: z.number().int().min(1024).max(262144).default(32768),
  })
  .default({});
