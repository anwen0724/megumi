// Defines input-owned identifier types for raw and parsed input facts.
import { z } from 'zod';
import type { Brand } from '@megumi/shared/primitives';

export const InputIdPrefixSchema = z.enum(['raw-input', 'parsed-input']);
export type InputIdPrefix = z.infer<typeof InputIdPrefixSchema>;

export type RawInputId = Brand<string, 'RawInputId'>;
export type ParsedInputId = Brand<string, 'ParsedInputId'>;

export function createInputEntityId(prefix: 'raw-input', value: string): RawInputId;
export function createInputEntityId(prefix: 'parsed-input', value: string): ParsedInputId;
export function createInputEntityId(prefix: InputIdPrefix, value: string): RawInputId | ParsedInputId {
  return `${prefix}:${value}` as RawInputId | ParsedInputId;
}

export function createParsedInputId(value: string): ParsedInputId {
  return createInputEntityId('parsed-input', value);
}
