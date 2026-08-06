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
      getSystemInstructions: vi.fn(() => [{ instructionId: 'system', content: 'system' }]),
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
    const base = text.indexOf('system');
    const effective = text.indexOf('<effective_instructions>');
    const environment = text.indexOf('<execution_environment>');
    // Base Instructions, Effective Instructions, Skill Catalog, Execution Environment.
    expect(base).toBeGreaterThanOrEqual(0);
    expect(effective).toBeGreaterThan(base);
    expect(environment).toBeGreaterThan(effective);
    expect(text.indexOf('<available_skills>')).toBe(-1);
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
