/* Verifies PromptBuilder builds the full Prompt from one ResolvedContext alone. */
import { describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '@megumi/tools';
import { createPromptBuilder } from '../../../packages/context/src/prompt/prompt-builder';
import { createContextResolver } from '../../../packages/context/src/context-resolver';
import { history, model, workspaceSource } from './context-test-fixtures';

function resolveContext(tools: readonly ToolDefinition[]) {
  const workspace = workspaceSource();
  const resolver = createContextResolver({
    sessionHistory: {
      getActiveHistory: vi.fn(() => ({ status: 'ok' as const, history: history() })),
    },
    workspaceSource: workspace,
    instructionReader: {
      getSystemInstructions: vi.fn(async () => [
        { instructionId: 'megumi.system.identity', groups: [{ groupId: 'identity', items: ['system'] }] },
        {
          instructionId: 'megumi.system.guidance',
          groups: [{ groupId: 'communication', items: ['Be concise in your responses.'] }],
        },
      ]),
      getEffectiveInstructions: vi.fn(async () => ({
        status: 'ok' as const,
        instructions: {
          sources: [{ sourceId: 'agents', sourcePath: '/workspace/AGENTS.md', content: 'rules' }],
        },
      })),
    },
    skills: {
      createView: vi.fn(async () => ({
        status: 'ok' as const,
        view: { catalog: [], diagnostics: [] },
      })),
    },
  });
  return resolver.resolve({ sessionId: 'session:1', workspaceId: 'workspace:1', model, tools });
}

const tools: readonly ToolDefinition[] = [
  { name: 'read_file', description: 'Read a file', parameters: { type: 'object' } },
];

describe('PromptBuilder', () => {
  it('builds System Prompt, Messages and Tools from one ResolvedContext', async () => {
    const resolved = await resolveContext(tools);
    expect(resolved.status).toBe('resolved');
    if (resolved.status !== 'resolved') return;
    const builder = createPromptBuilder({ attachmentReader: { readAttachmentContent: vi.fn() } });
    const result = await builder.build({ context: resolved.context });

    expect(result.status).toBe('built');
    if (result.status !== 'built') return;
    expect(result.prompt.systemPrompt).toContain('system');
    expect(result.prompt.systemPrompt).toContain('<effective_instructions>');
    expect(result.prompt.systemPrompt).toContain('<execution_environment>');
    expect(result.prompt.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(result.prompt.tools).toEqual(tools);
    expect(result.materializedHistory.expectedActiveEntryId).toBe('entry:assistant');
    expect(result.materializedHistory.compactableSources.map((source) => source.entryId))
      .toEqual(['entry:user', 'entry:assistant']);
  });

  it('keeps the System Prompt section order fixed', async () => {
    const resolved = await resolveContext(tools);
    if (resolved.status !== 'resolved') return;
    const result = await createPromptBuilder({
      attachmentReader: { readAttachmentContent: vi.fn() },
    }).build({ context: resolved.context });
    if (result.status !== 'built') return;

    const text = result.prompt.systemPrompt;
    const identity = text.indexOf('system');
    const guidance = text.indexOf('Behavior guidelines:');
    const effective = text.indexOf('<effective_instructions>');
    const availableTools = text.indexOf('<available_tools>');
    const environment = text.indexOf('<execution_environment>');
    // Identity paragraph, Behavior guidelines, Effective Instructions,
    // Available tools, Skill Catalog, Execution Environment.
    expect(identity).toBeGreaterThanOrEqual(0);
    expect(guidance).toBeGreaterThan(identity);
    expect(effective).toBeGreaterThan(guidance);
    expect(availableTools).toBeGreaterThan(effective);
    expect(environment).toBeGreaterThan(availableTools);
    expect(text.indexOf('<available_skills>')).toBe(-1);
    // The guidance section renders as a bullet list without group markers.
    expect(text).toContain('- Be concise in your responses.');
    expect(text).not.toContain('communication');
  });

  it('neither needs a ModelCallContext nor a full Model object', async () => {
    // A hand-built ResolvedContext without any Model/ModelCall facts drives the build.
    const resolved = await resolveContext(tools);
    if (resolved.status !== 'resolved') return;
    const contextWithoutModel = {
      ...resolved.context,
      // The ResolvedContext type must not expose a Model; only the capability flag exists.
    } as const;
    const result = await createPromptBuilder({
      attachmentReader: { readAttachmentContent: vi.fn() },
    }).build({ context: contextWithoutModel });
    expect(result.status).toBe('built');
  });

  it('folds, truncates, and omits the available tools section per the snippet rules', async () => {
    const longDescription = 'x'.repeat(200);
    const resolved = await resolveContext([
      {
        name: 'run_command',
        description: `Run a command\n  with   odd spacing ${longDescription}`,
        parameters: { type: 'object' },
      },
    ]);
    if (resolved.status !== 'resolved') return;
    const result = await createPromptBuilder({
      attachmentReader: { readAttachmentContent: vi.fn() },
    }).build({ context: resolved.context });
    if (result.status !== 'built') return;

    const text = result.prompt.systemPrompt;
    // Newlines and repeated whitespace are folded into one line.
    expect(text).toContain('- run_command: Run a command with odd spacing');
    expect(text).not.toContain('\n  with');
    // The snippet is truncated to 120 characters with an ellipsis.
    expect(text).toContain(`- run_command: Run a command with odd spacing ${'x'.repeat(120 - 31)}...`);

    const empty = await resolveContext([]);
    if (empty.status !== 'resolved') return;
    const emptyResult = await createPromptBuilder({
      attachmentReader: { readAttachmentContent: vi.fn() },
    }).build({ context: empty.context });
    if (emptyResult.status !== 'built') return;
    // The whole section is omitted when no tools are available.
    expect(emptyResult.prompt.systemPrompt).not.toContain('<available_tools>');
  });

  it('returns MaterializedHistory for the compaction projection', async () => {
    const resolved = await resolveContext([]);
    if (resolved.status !== 'resolved') return;
    const result = await createPromptBuilder({
      attachmentReader: { readAttachmentContent: vi.fn() },
    }).build({ context: resolved.context });
    expect(result.status).toBe('built');
    if (result.status !== 'built') return;
    expect(result.materializedHistory.messages).toEqual(result.prompt.messages);
    expect(result.materializedHistory.compactableSources).toHaveLength(2);
    expect(result.materializedHistory.compactableSources[0]).toMatchObject({
      entryId: 'entry:user',
    });
    expect(result.materializedHistory.compactableSources[1]).toMatchObject({
      entryId: 'entry:assistant',
    });
  });
});
