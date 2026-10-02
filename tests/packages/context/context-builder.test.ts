// @vitest-environment node
/* Verifies model-facing Context through real Session, Instructions, and Skills. */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createContext, type CreateContextOptions } from '@megumi/agent-runtime/context/index';
import { createInstructionReader } from '@megumi/agent-runtime/resources/instructions/index';
import { createTraceRecorder } from '@megumi/application/observability/trace/trace-recorder';
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

const sourceFailures: Array<{
  owner: string;
  code: string;
  inject: (options: CreateContextOptions) => void;
}> = [
  {
    owner: 'session',
    code: 'session_history_failed',
    inject: (options) => {
      options.sessionHistory.getActiveHistory = () => ({
        status: 'failed',
        failure: { code: 'history_unreadable', message: 'Unreadable history' },
      });
    },
  },
  {
    owner: 'workspace',
    code: 'workspace_failed',
    inject: (options) => {
      options.workspaceSource.readWorkspace = async () => ({
        status: 'failed',
        failure: { code: 'workspace_not_found', message: 'Missing workspace' },
      });
    },
  },
  {
    owner: 'instructions',
    code: 'effective_instructions_failed',
    inject: (options) => {
      options.instructionReader.getEffectiveInstructions = async () => ({
        status: 'failed',
        failure: {
          code: 'instruction_source_read_failed',
          message: 'Unreadable instructions',
          sourcePath: 'AGENTS.md',
        },
      });
    },
  },
  {
    owner: 'skills',
    code: 'skill_view_failed',
    inject: (options) => {
      options.skills.createView = async () => ({
        status: 'failed',
        failure: { code: 'skills_unavailable', message: 'Unreadable Skills' },
      });
    },
  },
];

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
    const result = await createContext({
      ...f.options,
      instructionReader: createInstructionReader({
        megumiHomePath: f.root,
        systemContentRoot: contentRoot,
      }),
    }).build({
      ...f.buildRequest,
      modelCallContext: { ...f.buildRequest.modelCallContext, tools: [tool] },
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Prompt unavailable');
    expect(result.prompt.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(result.prompt.messages)).toContain('Saved answer');
    for (const content of [
      'Original identity paragraph.',
      'Original fixed guidance.',
      'Project-specific guidance.',
      'Check evidence before answering.',
    ]) {
      expect(result.prompt.systemPrompt).toContain(content);
    }
    expect(result.prompt.tools).toMatchObject([{ name: 'inspect_result' }]);
  });

  it('offers the Skill catalog without injecting unselected Skill bodies into the prompt', async () => {
    const f = await fixture();
    const directory = path.join(f.root, 'skills', 'review');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'SKILL.md'),
      '---\nname: review\ndescription: Review source changes carefully\n---\nSelected instructions.',
    );
    const result = await createContext(f.options).build(f.buildRequest);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Prompt unavailable');
    expect(result.prompt.systemPrompt).toContain('Review source changes carefully');
    expect(result.prompt.systemPrompt).toContain(path.join(directory, 'SKILL.md'));
    expect(JSON.stringify(result.prompt)).not.toContain('Selected instructions.');
  });

  it.each(sourceFailures)(
    'preserves the $owner failure instead of reporting a generic build error',
    async ({ owner, code, inject }) => {
      const f = await fixture();
      inject(f.options); // Inject only the selected fault; other owners still execute normally.
      expect(await createContext(f.options).build(f.buildRequest)).toMatchObject({
        status: 'failed',
        failure: { code, cause: { owner } },
      });
    },
  );

  it('reports an unexpected source exception as a stable build failure', async () => {
    const f = await fixture();
    f.options.sessionHistory.getActiveHistory = () => {
      throw new Error('Database unavailable');
    };
    expect(await createContext(f.options).build(f.buildRequest)).toMatchObject({
      status: 'failed',
      failure: { code: 'context_build_failed', retryable: false },
    });
  });

  it('returns cancelled before resolution and when Skills reports cancellation', async () => {
    const f = await fixture();
    const controller = new AbortController();
    controller.abort();
    expect(
      await createContext(f.options).build({ ...f.buildRequest, signal: controller.signal }),
    ).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });
    f.options.skills.createView = async () => ({
      status: 'failed',
      failure: { code: 'cancelled' },
    });
    expect(await createContext(f.options).build(f.buildRequest)).toMatchObject({
      status: 'failed',
      failure: { code: 'cancelled' },
    });
  });

  it('honors cancellation requested while a source is resolving', async () => {
    const f = await fixture();
    const controller = new AbortController();
    const read = f.options.workspaceSource.readWorkspace;
    f.options.workspaceSource.readWorkspace = async (request) => {
      const result = await read(request);
      controller.abort();
      return result;
    };
    expect(
      await createContext(f.options).build({ ...f.buildRequest, signal: controller.signal }),
    ).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });
  });

  it('rejects invalid execution environments and Tool definitions with distinct codes', async () => {
    const f = await fixture();
    expect(
      await createContext(f.options).build({
        ...f.buildRequest,
        modelCallContext: {
          ...f.buildRequest.modelCallContext,
          tools: [{ name: 'broken' } as never],
        },
      }),
    ).toMatchObject({ status: 'failed', failure: { code: 'tool_definitions_invalid' } });
    f.options.workspaceSource.readWorkspace = async () => ({
      status: 'ok',
      workspaceRoot: f.workspaceRoot,
      environment: { workingDirectory: f.workspaceRoot, operatingSystem: '', shell: 'powershell' },
    });
    expect(await createContext(f.options).build(f.buildRequest)).toMatchObject({
      status: 'failed',
      failure: { code: 'execution_environment_invalid' },
    });
  });

  it('rejects illegal compaction policies before invoking the model', async () => {
    const f = await fixture();
    const policies = [{ keepRecentTokens: Number.NaN }, { minimumRecentMessages: -3 }];
    for (const policy of policies) {
      const context = createContext({
        ...f.options,
        policy,
        models: {
          completeSimple: async () => {
            throw new Error('Invalid policy must not contact the model');
          },
        },
      });
      expect(await context.build(f.buildRequest)).toMatchObject({
        status: 'failed',
        failure: { code: 'policy_invalid' },
      });
    }
  });

  it('reports window exhaustion when the conversation cannot fit and compaction is disabled', async () => {
    const f = await fixture(undefined, 'large input '.repeat(30_000));
    expect(
      await createContext({ ...f.options, policy: { enabled: false, reserveTokens: 10 } }).build({
        ...f.buildRequest,
      }),
    ).toMatchObject({ status: 'failed', failure: { code: 'context_window_exceeded' } });
  });

  it('materializes saved images and degrades unreadable images only for text-only models', async () => {
    const f = await fixture([
      {
        type: 'image',
        name: 'image.png',
        media_type: 'image/png',
        byte_length: 2,
        bytes: new Uint8Array([72, 105]),
      },
    ]);
    const ready = await createContext(f.options).build(f.buildRequest);
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') throw new Error('Image prompt unavailable');
    expect(ready.prompt.messages[0]?.content).toContainEqual({
      type: 'image',
      mimeType: 'image/png',
      data: 'SGk=',
    });
    const saved = f.history.getActiveHistory({ session_id: f.sessionId });
    if (saved.status !== 'ok' || saved.history[0]?.type !== 'message')
      throw new Error('Saved image unavailable');
    await f.contentStore.delete(saved.history[0].attachments[0]!.source_value);
    expect(await createContext(f.options).build(f.buildRequest)).toMatchObject({
      status: 'failed',
      failure: { code: 'image_materialization_failed' },
    });
    const textOnly = await createContext(f.options).build({
      ...f.buildRequest,
      modelCallContext: {
        ...f.buildRequest.modelCallContext,
        run: {
          ...f.buildRequest.modelCallContext.run,
          model: { ...contextModel, input: ['text'] },
        },
      },
    });
    expect(textOnly.status).toBe('ready');
    if (textOnly.status !== 'ready') throw new Error('Text-only prompt unavailable');
    expect(JSON.stringify(textOnly.prompt.messages)).toContain('cannot view');
    expect(JSON.stringify(textOnly.prompt.messages)).not.toContain('"type":"image"');
  });

  it('rejects a saved tool result with no matching model call', async () => {
    const f = await fixture();
    expect(
      f.history.saveToolResultMessage({
        message_id: 'orphan-tool',
        session_id: f.sessionId,
        execution_id: 'execution',
        tool_call_id: 'missing-call',
        tool_name: 'read_file',
        status: 'success',
        content: [{ type: 'text', text: 'Result without intent' }],
        completed_at: savedAt,
      }),
    ).toMatchObject({ status: 'saved' });
    expect(await createContext(f.options).build(f.buildRequest)).toMatchObject({
      status: 'failed',
      failure: { code: 'protocol_closure_failed' },
    });
  });

  it('still returns the saved conversation when diagnostic storage fails', async () => {
    const f = await fixture();
    const observability = createTraceRecorder({
      enqueue: () => {
        throw new Error('Trace storage unavailable');
      },
    });
    const result = await observability.withTrace({ kind: 'conversation' }, () =>
      createContext({ ...f.options, observability }).build(f.buildRequest),
    );
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Prompt unavailable');
    expect(JSON.stringify(result.prompt.messages)).toContain('Explain the result');
  });
});
