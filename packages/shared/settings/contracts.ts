// Defines user-editable application settings contracts shared across Main, Preload, and Renderer.
// Raw settings represent the sparse settings.json file; resolved settings are defaults plus raw overrides.
import { z } from 'zod';

export const AppThemeNameSchema = z.enum([
  'megumi-warm',
  'neutral-light',
  'graphite-dark',
  'sage-mist',
  'midnight-blue',
]);
export type AppThemeName = z.infer<typeof AppThemeNameSchema>;

export const AppMemorySettingsRawSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .strict();

export const AppCompactionSettingsRawSchema = z
  .object({
    enabled: z.boolean().optional(),
    reserveTokens: z.number().int().positive().optional(),
    keepRecentTokens: z.number().int().positive().optional(),
  })
  .strict();

export const AppSettingsRawSchema = z
  .object({
    theme: AppThemeNameSchema.optional(),
    memory: AppMemorySettingsRawSchema.optional(),
    compaction: AppCompactionSettingsRawSchema.optional(),
  })
  .strict();
export type AppSettingsRaw = z.infer<typeof AppSettingsRawSchema>;

export const AppMemorySettingsResolvedSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export const AppCompactionSettingsResolvedSchema = z
  .object({
    enabled: z.boolean(),
    reserveTokens: z.number().int().positive(),
    keepRecentTokens: z.number().int().positive(),
  })
  .strict();

export const AppSettingsResolvedSchema = z
  .object({
    theme: AppThemeNameSchema,
    memory: AppMemorySettingsResolvedSchema,
    compaction: AppCompactionSettingsResolvedSchema,
  })
  .strict();
export type AppSettingsResolved = z.infer<typeof AppSettingsResolvedSchema>;

export const DEFAULT_APP_SETTINGS = AppSettingsResolvedSchema.parse({
  theme: 'midnight-blue',
  memory: {
    enabled: false,
  },
  compaction: {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
  },
} satisfies AppSettingsResolved);

export function resolveAppSettings(raw: unknown): AppSettingsResolved {
  const parsed = AppSettingsRawSchema.parse(raw ?? {});
  return AppSettingsResolvedSchema.parse({
    ...DEFAULT_APP_SETTINGS,
    ...definedObject({
      theme: parsed.theme,
      memory: parsed.memory
        ? {
            ...DEFAULT_APP_SETTINGS.memory,
            ...definedObject(parsed.memory),
          }
        : undefined,
      compaction: parsed.compaction
        ? {
            ...DEFAULT_APP_SETTINGS.compaction,
            ...definedObject(parsed.compaction),
          }
        : undefined,
    }),
  });
}

export function mergeRawAppSettings(current: AppSettingsRaw, patch: AppSettingsRaw): AppSettingsRaw {
  const currentParsed = AppSettingsRawSchema.parse(current);
  const patchParsed = AppSettingsRawSchema.parse(patch);
  return AppSettingsRawSchema.parse({
    ...currentParsed,
    ...definedObject({
      theme: patchParsed.theme,
      memory: patchParsed.memory
        ? {
            ...(currentParsed.memory ?? {}),
            ...definedObject(patchParsed.memory),
          }
        : undefined,
      compaction: patchParsed.compaction
        ? {
            ...(currentParsed.compaction ?? {}),
            ...definedObject(patchParsed.compaction),
          }
        : undefined,
    }),
  });
}

function definedObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}
