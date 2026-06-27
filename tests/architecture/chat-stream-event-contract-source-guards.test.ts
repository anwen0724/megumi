// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

function chatStreamEventBaseBody(): string {
  const contract = read('packages/shared/chat-stream/events.ts');
  const match = /export interface ChatStreamEventBase\s*\{(?<body>[\s\S]*?)\n\}/.exec(contract);

  expect(match?.groups?.body).toBeDefined();
  return match?.groups?.body ?? '';
}

const CHAT_STREAM_CONTRACT_FILES = [
  'packages/shared/chat-stream/events.ts',
  'packages/shared/chat-stream/event-schemas.ts',
  'packages/shared/chat-stream/event-factory.ts',
];

describe('chat stream event contract source guards', () => {
  it('uses assistant text phase events instead of assistant answer events', () => {
    const contract = read('packages/shared/chat-stream/events.ts');

    for (const eventType of [
      'assistant.text.started',
      'assistant.text.delta',
      'assistant.text.completed',
      'assistant.text.failed',
      'assistant.text.cancelled_partial',
    ]) {
      expect(contract).toContain(`'${eventType}'`);
    }

    expect(contract).toContain("'prelude'");
    expect(contract).toContain("'answer'");

    for (const file of CHAT_STREAM_CONTRACT_FILES) {
      expect(read(file)).not.toContain('assistant.answer.');
    }
  });

  it('keeps chat stream events independent from runtime event envelopes', () => {
    for (const file of CHAT_STREAM_CONTRACT_FILES) {
      const source = read(file);

      expect(source).not.toContain('RuntimeEvent');
      expect(source).not.toMatch(/from ['"].*runtime-events['"]/);
      expect(source).not.toContain('schemaVersion');
      expect(source).not.toContain('payload:');
    }
  });

  it('keeps stream ownership fields explicit in the base event contract', () => {
    const baseContract = chatStreamEventBaseBody();

    for (const field of ['projectId', 'sessionId', 'runId', 'streamId', 'streamKind', 'seq']) {
      expect(baseContract).toMatch(new RegExp(`\\b${field}:`));
    }
  });
});
