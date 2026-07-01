// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ParsedInputSchema,
  RawInputSchema,
  createParsedInputId,
  normalizeRawInput,
  parseRawInput,
} from '@megumi/coding-agent/input';

describe('input package normalization', () => {
  it('normalizes raw text input into stable ParsedInput facts', () => {
    const parsed = parseRawInput({
      id: 'raw-input:1',
      source: {
        kind: 'composer',
        surface: 'chat-input',
      },
      text: 'Read package.json',
      target: {
        kind: 'session',
        sessionId: 'session-1',
      },
      metadata: {
        clientRequestId: 'client-1',
      },
      createdAt: '2026-06-21T00:00:00.000Z',
    }, {
      createId: (prefix, value) => `${prefix}:${value}`,
    });

    expect(parsed).toEqual({
      id: 'parsed-input:raw-input:1',
      rawInputId: 'raw-input:1',
      source: {
        kind: 'composer',
        surface: 'chat-input',
      },
      rawKind: 'text',
      kind: 'user_input',
      text: 'Read package.json',
      attachments: [],
      references: [],
      target: {
        kind: 'session',
        sessionId: 'session-1',
      },
      facts: [],
      metadata: {
        clientRequestId: 'client-1',
      },
      createdAt: '2026-06-21T00:00:00.000Z',
    });
    expect(ParsedInputSchema.parse(parsed)).toEqual(parsed);
  });

  it('does not dispatch slash commands during raw input normalization', () => {
    const parsed = normalizeRawInput({
      rawInput: {
        id: 'raw-command:1',
        source: {
          kind: 'composer',
        },
        text: '/review current work',
        createdAt: '2026-06-21T00:00:00.000Z',
      },
      createId: (prefix, value) => `${prefix}:${value}`,
    });

    expect(parsed.rawKind).toBe('slash_command');
    expect(parsed.kind).toBe('user_input');
    expect(parsed.facts).toEqual([]);
  });

  it('keeps attachments, references, and target as input facts', () => {
    const raw = RawInputSchema.parse({
      id: 'raw-input:attachments',
      source: {
        kind: 'desktop',
        metadata: {
          windowId: 'main',
        },
      },
      attachments: [{
        id: 'attachment:1',
        kind: 'file',
        name: 'package.json',
        path: 'package.json',
        mimeType: 'application/json',
        sizeBytes: 123,
      }],
      references: [{
        kind: 'selected_range',
        filePath: 'src/index.ts',
        startLine: 1,
        endLine: 5,
      }],
      target: {
        kind: 'selection',
        filePath: 'src/index.ts',
        startLine: 1,
        endLine: 5,
      },
      createdAt: '2026-06-21T00:00:00.000Z',
    });

    const parsed = parseRawInput(raw);

    expect(parsed.rawKind).toBe('attachment');
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.references).toHaveLength(1);
    expect(parsed.target).toEqual({
      kind: 'selection',
      filePath: 'src/index.ts',
      startLine: 1,
      endLine: 5,
    });
  });

  it('creates parsed input IDs using the input-owned helper', () => {
    expect(createParsedInputId('abc')).toBe('parsed-input:abc');
  });
});
