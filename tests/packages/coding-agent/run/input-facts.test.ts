// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createCodingAgentRunInputFacts,
  createRuntimeFactsForRunInput,
} from '@megumi/coding-agent/run';
import type { ParsedInput } from '@megumi/input';

describe('coding-agent run input facts', () => {
  it('maps ParsedInput command facts into Coding Agent run facts', () => {
    const parsedInput: ParsedInput = {
      id: 'parsed-input:1',
      rawInputId: 'raw-input:1',
      source: { kind: 'composer', surface: 'chat-input' },
      rawKind: 'slash_command',
      kind: 'command_input',
      text: '/review src/session.ts',
      attachments: [],
      references: [],
      target: { kind: 'session', sessionId: 'session-1' },
      facts: [{
        kind: 'command',
        commandName: 'review',
        argsText: 'src/session.ts',
        rawText: '/review src/session.ts',
        target: 'agent_command',
      }],
      createdAt: '2026-06-21T00:00:00.000Z',
    };

    expect(createCodingAgentRunInputFacts(parsedInput)).toEqual({
      parsedInputId: 'parsed-input:1',
      rawInputId: 'raw-input:1',
      rawKind: 'slash_command',
      inputKind: 'command_input',
      effectiveUserText: '/review src/session.ts',
      facts: [{
        kind: 'agent_command',
        commandName: 'review',
        argsText: 'src/session.ts',
        rawText: '/review src/session.ts',
      }],
    });
  });

  it('turns prompt template, skill, and app operation facts into model-visible runtime facts', () => {
    const inputFacts = createCodingAgentRunInputFacts({
      id: 'parsed-input:2',
      rawInputId: 'raw-input:2',
      source: { kind: 'composer' },
      rawKind: 'slash_command',
      kind: 'command_input',
      text: '/summary current work',
      attachments: [],
      references: [],
      facts: [
        {
          kind: 'prompt_template',
          commandName: 'summary',
          argsText: 'current work',
          templateId: 'summary',
        },
        {
          kind: 'skill',
          skillName: 'write-doc',
          argsText: 'architecture',
          source: 'command',
        },
        {
          kind: 'app_operation',
          operation: 'session.create',
          argsText: '',
          source: 'command',
        },
      ],
      createdAt: '2026-06-21T00:00:00.000Z',
    });

    expect(createRuntimeFactsForRunInput(inputFacts)).toEqual([
      {
        factId: 'run-input:parsed-input:2',
        factKind: 'parsed_input',
        text: 'Input kind: command_input. Raw kind: slash_command.',
        required: true,
        metadata: {
          parsedInputId: 'parsed-input:2',
          rawInputId: 'raw-input:2',
        },
      },
      {
        factId: 'run-input:parsed-input:2:fact:1',
        factKind: 'prompt_template',
        text: 'Prompt template command summary was selected with args: current work.',
        required: true,
        metadata: {
          commandName: 'summary',
          templateId: 'summary',
        },
      },
      {
        factId: 'run-input:parsed-input:2:fact:2',
        factKind: 'skill_trigger',
        text: 'Skill write-doc was triggered with args: architecture.',
        required: true,
        metadata: {
          skillName: 'write-doc',
        },
      },
      {
        factId: 'run-input:parsed-input:2:fact:3',
        factKind: 'app_operation',
        text: 'App operation session.create was detected with args: <none>.',
        required: false,
        metadata: {
          operation: 'session.create',
        },
      },
    ]);
  });
});
