/* Defines audio device preferences and voice input/output configuration. */
import { z } from 'zod';
import { EnvironmentVariableSchema } from './models';

export const VoiceConfigurationSchema = z.object({
  inputDeviceId: z.string().min(1).default('default'),
  outputDeviceId: z.string().min(1).default('default'),
  recognitionLanguage: z.enum(['auto', 'zh', 'en']).default('auto'),
  readAloudEnabled: z.boolean().default(false),
  tts: z.object({
    provider: z.literal('minimax').default('minimax'),
    voiceId: z.string().min(1).default('female-shaonv'),
    apiKeyEnv: EnvironmentVariableSchema.optional(),
  }).default({}),
}).default({});
