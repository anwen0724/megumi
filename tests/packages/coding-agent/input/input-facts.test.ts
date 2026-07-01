// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createCodingAgentRunInputFacts,
  createRuntimeFactsForRunInput,
} from '@megumi/coding-agent/input/facts';
import type { ParsedInput } from '@megumi/coding-agent/input';

describe('coding-agent input facts', () => {
  it('maps ParsedInput command facts into Coding Agent run facts', () => {
    const parsedInput: ParsedInput = {
      id: 'parsed-input:1',
      rawInputId: 'raw-input:1',
      source: { kind: 'composer', surface: 'chat-input' },
      rawKind: 'slash_command',
      kind: 'user_input',
      text: '/review src/session.ts',
      attachments: [],
      references: [],
      target: { kind: 'session', sessionId: 'session-1' },
      facts: [{
        kind: 'command',
        name: 'review',
        source: { kind: 'built_in' },
        arguments_input: 'src/session.ts',
        raw_input: '/review src/session.ts',
      }],
      createdAt: '2026-06-21T00:00:00.000Z',
    };

    expect(createCodingAgentRunInputFacts(parsedInput)).toEqual({
      parsedInputId: 'parsed-input:1',
      rawInputId: 'raw-input:1',
      rawKind: 'slash_command',
      inputKind: 'user_input',
      effectiveUserText: '/review src/session.ts',
      facts: [{
        kind: 'command',
        name: 'review',
        source: { kind: 'built_in' },
        arguments_input: 'src/session.ts',
        raw_input: '/review src/session.ts',
      }],
    });
  });

  it('turns command facts into model-visible runtime facts', () => {
    const inputFacts = createCodingAgentRunInputFacts({
      id: 'parsed-input:2',
      rawInputId: 'raw-input:2',
      source: { kind: 'composer' },
      rawKind: 'slash_command',
      kind: 'user_input',
      text: '/review src/index.ts',
      attachments: [],
      references: [],
      facts: [{
        kind: 'command',
        name: 'review',
        source: { kind: 'built_in' },
        arguments_input: 'src/index.ts',
        raw_input: '/review src/index.ts',
      }],
      createdAt: '2026-06-21T00:00:00.000Z',
    });

    expect(createRuntimeFactsForRunInput(inputFacts)).toEqual([
      {
        factId: 'run-input:parsed-input:2',
        factKind: 'parsed_input',
        text: 'Input kind: user_input. Raw kind: slash_command.',
        required: true,
        metadata: {
          parsedInputId: 'parsed-input:2',
          rawInputId: 'raw-input:2',
        },
      },
      {
        factId: 'run-input:parsed-input:2:fact:1',
        factKind: 'agent_command',
        text: 'Command review was selected with args: src/index.ts.',
        required: true,
        metadata: {
          name: 'review',
          source: { kind: 'built_in' },
          raw_input: '/review src/index.ts',
        },
      },
    ]);
  });

  it('keeps the derived runtime-fact part id within the 128-char id limit for UUID-based ids', () => {
    const partPrefix = 'part:runtime-fact:';
    const maxIdLength = 128;
    const longParsedInputId = `parsed-input_raw-input:run:${'a'.repeat(36)}:message:${'b'.repeat(36)}`;

    const facts = createRuntimeFactsForRunInput(
      createCodingAgentRunInputFacts({
        id: longParsedInputId,
        rawInputId: longParsedInputId,
        source: { kind: 'desktop', surface: 'session-message' },
        rawKind: 'text',
        kind: 'user_input',
        text: 'Say hello',
        attachments: [],
        references: [],
        facts: [{
          kind: 'command',
          name: 'review',
          source: { kind: 'built_in' },
          arguments_input: 'src/session.ts',
          raw_input: '/review src/session.ts',
        }],
        createdAt: '2026-06-21T00:00:00.000Z',
      }),
    );

    for (const fact of facts) {
      expect(`${partPrefix}${fact.factId}`.length).toBeLessThanOrEqual(maxIdLength);
    }
  });
});
