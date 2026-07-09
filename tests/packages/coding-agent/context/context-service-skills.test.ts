import { describe, expect, it, vi } from 'vitest';
import { ContextService, type ContextSessionFactRepository } from '@megumi/coding-agent/context';

describe('context service skill sources', () => {
  it('adds lightweight skill catalog for agent response prompts without content or rendered name', async () => {
    const service = new ContextService({
      repository: createRepository(),
      skillSource: {
        getSkillCatalog: vi.fn(async () => ({
          status: 'ok',
          skills: [{
            skillId: 'superpowers:brainstorming',
            name: 'superpowers:brainstorming',
            description: 'Explore intent before implementation',
          }],
        })),
      },
      promptResources: { system_prompt: 'You are Megumi' },
      ids: { promptId: () => 'prompt:1' },
    });

    const context = await service.getSessionContext({
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      purpose: 'agent_response',
    });
    expect(context.status).toBe('ok');
    const sources = context.status === 'ok' ? context.session_context.sources : [];
    expect(sources).toContainEqual(expect.objectContaining({
      source_id: 'skill-catalog',
      source_kind: 'skill_catalog',
      metadata: { origin_module: 'skills' },
    }));

    const prompt = service.buildPrompt({
      session_context: context.status === 'ok' ? context.session_context : { session_id: 'session:1', sources: [] },
      purpose: 'agent_response',
    });
    expect(prompt.status).toBe('ok');
    const systemText = prompt.status === 'ok' ? prompt.prompt.messages[0]?.content ?? '' : '';
    expect(systemText).toContain('Available Skills');
    expect(systemText).toContain('skillId: superpowers:brainstorming');
    expect(systemText).toContain('description: Explore intent before implementation');
    expect(systemText).not.toContain('name: superpowers:brainstorming');
    expect(systemText).not.toContain('Use before creative work');
  });

  it('renders activated skill runtime source as required skill prompt part without metadata text', () => {
    const service = new ContextService({
      repository: createRepository(),
      promptResources: { system_prompt: 'You are Megumi' },
      ids: { promptId: () => 'prompt:1' },
    });

    const prompt = service.buildPrompt({
      session_context: { session_id: 'session:1', sources: [] },
      purpose: 'agent_response',
      runtime_sources: [{
        source_id: 'skill:superpowers:brainstorming',
        source_kind: 'skill',
        text: 'Ask clarifying questions before implementation.',
        persisted: false,
        metadata: {
          origin_module: 'skills',
          skillId: 'superpowers:brainstorming',
          name: 'superpowers:brainstorming',
          description: 'Explore intent before implementation',
        },
      }],
    });

    expect(prompt.status).toBe('ok');
    const systemText = prompt.status === 'ok' ? prompt.prompt.messages[0]?.content ?? '' : '';
    expect(systemText).toContain('Active Skill Instructions');
    expect(systemText).toContain('This skill was activated for the current task. Follow these instructions.');
    expect(systemText).toContain('<skill_content>');
    expect(systemText).toContain('Ask clarifying questions before implementation.');
    expect(systemText).not.toContain('Skill ID:');
    expect(systemText).not.toContain('Description: Explore intent before implementation');
  });
});

function createRepository(): ContextSessionFactRepository {
  return {
    listMessagesBySession: vi.fn(() => []),
    listSessionCompactionsBySession: vi.fn(() => []),
    listRuntimeFactsBySession: vi.fn(() => []),
    listToolResultsBySession: vi.fn(() => []),
  };
}
