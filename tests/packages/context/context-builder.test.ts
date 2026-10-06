// @vitest-environment node
/* Verifies model-facing Context through real Session, Instructions, and Skills. */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCodingContext } from '@megumi/application/coding/prepare-context';
import { createContextFixture, contextModel } from './context-behavior-fixture';
import { savedAt } from '../session/session-test-fixture';

type Fixture = Awaited<ReturnType<typeof createContextFixture>>;
const fixtures: Fixture[] = [];
afterEach(() => {
  for (const item of fixtures.splice(0)) item.cleanup();
});

type Attachments = Parameters<Fixture['history']['saveUserMessage']>[0]['attachments'];

async function fixture(attachments?: Attachments, text = 'Explain the result') {
  const f = await createContextFixture();
  fixtures.push(f);
  await saveUser(f, attachments, text);
  return f;
}

async function saveUser(f: Fixture, attachments: Attachments, text: string) {
  const result = await f.history.saveUserMessage({
    message_id: 'user',
    session_id: f.sessionId,
    execution_id: 'execution',
    display_content: [{ type: 'text', text }],
    model_content: [{ type: 'text', text }],
    attachments,
    created_at: savedAt,
  });
  if (result.status !== 'saved') throw new Error('User message was not saved');
  return result;
}

describe('Context.build', () => {
  it('combines committed messages, instructions, and requested Tool guidance', async () => {
    const f = await fixture();
    expect(
      f.history.saveAssistantReply({
        message_id: 'reply',
        session_id: f.sessionId,
        execution_id: 'execution',
        status: 'completed',
        content: [{ type: 'text', text: 'Saved answer' }],
        completed_at: savedAt,
      }),
    ).toMatchObject({ status: 'saved' });
    const contentRoot = path.join(f.root, 'instructions');
    fs.mkdirSync(contentRoot);
    fs.writeFileSync(path.join(contentRoot, 'common.md'), 'Original identity paragraph.');
    fs.writeFileSync(path.join(contentRoot, 'conversation.md'), 'Original fixed guidance.');
    fs.writeFileSync(path.join(f.workspaceRoot, 'AGENTS.md'), 'Project-specific guidance.');
    const tool = {
      name: 'inspect_result',
      description: 'Inspect one result.',
      parameters: { type: 'object' as const },
      promptSnippet: 'Inspect result evidence.',
      promptGuidelines: ['Check evidence before answering.'],
    };
    const result = await createCodingContext({
      ...f.options,
      instructionDocuments: ['common', 'conversation'].map(instructionId => ({
        instructionId, sourcePath: path.join(contentRoot, instructionId + '.md'),
      })),
    }).prepare({ ...f.prepareRequest, tools: [tool] });
    expect(result.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(result.messages)).toContain('Saved answer');
    for (const content of [
      'Original identity paragraph.',
      'Original fixed guidance.',
      'Project-specific guidance.',
      'Check evidence before answering.',
    ]) {
      expect(result.systemPrompt).toContain(content);
    }
    expect(result.tools).toMatchObject([{ name: 'inspect_result' }]);
  });

  it('offers the Skill catalog without injecting unselected Skill bodies into the prompt', async () => {
    const f = await fixture();
    const directory = path.join(f.root, 'skills', 'review');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'SKILL.md'),
      '---\nname: review\ndescription: Review source changes carefully\n---\nSelected instructions.',
    );
    const result = await createCodingContext(f.options).prepare(f.prepareRequest);
    expect(result.systemPrompt).toContain('Review source changes carefully');
    expect(result.systemPrompt).toContain(path.join(directory, 'SKILL.md'));
    expect(JSON.stringify(result)).not.toContain('Selected instructions.');
  });

});
