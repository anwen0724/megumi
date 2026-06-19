// Defines input-owned identifier types for raw and parsed input facts.
import { z } from 'zod';
import { createId, type EntityId } from '../shared';

export const InputIdPrefixSchema = z.enum(['raw-input', 'parsed-input']);
export type InputIdPrefix = z.infer<typeof InputIdPrefixSchema>;

export type RawInputId = EntityId<'raw-input'>;
export type ParsedInputId = EntityId<'parsed-input'>;

export function createInputEntityId(prefix: 'raw-input', value: string): RawInputId;
export function createInputEntityId(prefix: 'parsed-input', value: string): ParsedInputId;
export function createInputEntityId(prefix: InputIdPrefix, value: string): EntityId<string> {
  return createId(prefix, value);
}

export function createParsedInputId(value: string): ParsedInputId {
  return createInputEntityId('parsed-input', value);
}
