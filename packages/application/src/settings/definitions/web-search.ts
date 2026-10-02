/* Defines search connection settings; credentials are stored separately. */
import { z } from 'zod';
import { EnvironmentVariableSchema, HttpUrlSchema } from './models';

export const WebSearchConfigurationSchema = z.object({
  provider: z.enum(['brave', 'tavily', 'exa', 'custom']).optional(),
  baseUrl: HttpUrlSchema.optional(),
  apiKeyEnv: EnvironmentVariableSchema.optional(),
}).superRefine((settings, context) => {
  if (settings.provider === 'custom' && !settings.baseUrl) {
    context.addIssue({
      code: 'custom',
      path: ['baseUrl'],
      message: 'Custom search providers require an API URL.',
    });
  }
}).default({});
