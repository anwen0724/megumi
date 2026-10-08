/* Defines application-wide automatic memory configuration. */
import { z } from 'zod';
import { ModelReferenceSchema } from './providers';

export const MemoryConfigurationSchema = z
  .object({
    generateMemories: z.boolean().default(true),
    useMemories: z.boolean().default(true),
    extractModel: ModelReferenceSchema.optional(),
    consolidationModel: ModelReferenceSchema.optional(),
    maxSourceAgeDays: z.number().int().min(1).max(90).default(30),
    minSourceIdleHours: z.number().int().min(1).max(48).default(6),
    maxSourcesPerRun: z.number().int().min(1).max(128).default(16),
    maxConsolidationSources: z.number().int().min(1).max(4096).default(256),
    maxUnusedDays: z.number().int().min(1).max(365).default(30),
  })
  .default({});
