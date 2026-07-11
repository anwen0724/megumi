/*
 * Verifies the provider-neutral tool set contains model-facing definitions only.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ToolSetSchema,
  type ToolSet,
} from '@megumi/ai';

describe('provider-neutral tool set', () => {
  it('round-trips model-facing tool definitions', () => {
    const toolSet: ToolSet = [
      {
        name: 'read_file',
        description: 'Read a workspace file.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ];

    expect(ToolSetSchema.parse(toolSet)).toEqual(toolSet);
  });

  it('rejects execution mappings from model-facing tool definitions', () => {
    expect(() => ToolSetSchema.parse([
      {
        name: 'read_file',
        description: 'Read a workspace file.',
        inputSchema: { type: 'object' },
        execute: 'desktop.readFile',
      },
    ])).toThrow();
  });
});
