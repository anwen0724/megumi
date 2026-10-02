/* Defines secret-free public Settings models and the internal settings.json schema. */
import { z } from 'zod';
import { GeneralSettingsSchema } from './definitions/general';
import { ModelsSettingsSchema } from './definitions/models';
import { ModelReferenceSchema } from './definitions/models';
import { ContextConfigurationSchema } from './definitions/context';
import { DiscoveryConfigurationSchema } from './definitions/discovery';
import { VoiceConfigurationSchema } from './definitions/voice';
import { WebSearchConfigurationSchema } from './definitions/web-search';
import { PermissionsConfigurationSchema } from './definitions/permissions';

export const ConfigurationSchema = z.object({
  general: GeneralSettingsSchema,
  models: ModelsSettingsSchema,
  context: ContextConfigurationSchema,
  discovery: DiscoveryConfigurationSchema,
  voice: VoiceConfigurationSchema,
  webSearch: WebSearchConfigurationSchema,
  permissions: PermissionsConfigurationSchema,
});
export type SettingsConfiguration = z.output<typeof ConfigurationSchema>;

export const GlobalOnlySettingsFields = {
  general: ['setupCompleted', 'language', 'theme'],
  voice: ['inputDeviceId', 'outputDeviceId'],
  discovery: [
    'candidateSupplyConfirmed',
    'recommendationGenerationTime',
    'recommendationCandidateCheckIntervalSeconds',
    'candidateSupplyCheckIntervalMinutes',
  ],
} satisfies { [K in keyof SettingsConfiguration]?: readonly (keyof SettingsConfiguration[K])[] };

export const ConfigurationFileSchema = z.object(Object.fromEntries(
  Object.entries(ConfigurationSchema.shape).map(([name, schema]) => [name, explicitField(schema)]),
));

export const ConfigurationPatchSchema = z.object(Object.fromEntries(
  Object.entries(ConfigurationSchema.shape).map(([name, schema]) => [name, explicitField(schema, true)]),
)).strict();

/** File fields stay optional and do not acquire defaults before files are merged. */
function explicitField(input: z.ZodTypeAny, patch = false): z.ZodTypeAny {
  let schema = input;
  while (true) {
    if (schema instanceof z.ZodDefault) schema = schema.removeDefault();
    else if (schema instanceof z.ZodOptional) schema = schema.unwrap();
    else if (schema instanceof z.ZodEffects && schema.innerType() instanceof z.ZodObject) schema = schema.innerType();
    else break;
  }
  if (schema instanceof z.ZodObject && schema !== ModelReferenceSchema) {
    const shape: Record<string, z.ZodTypeAny> = schema.shape;
    const object = z.object(Object.fromEntries(
      Object.entries(shape).map(([name, field]) => [name, explicitField(field, patch)]),
    ));
    schema = patch ? object.strict() : object;
  } else if (schema instanceof z.ZodRecord) {
    schema = z.record(schema.keySchema, explicitField(schema.valueSchema, patch));
  }
  return patch ? schema.nullable().optional() : schema.optional();
}
