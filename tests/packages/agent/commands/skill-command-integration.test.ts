import { describe, expect, it } from 'vitest';
import { createCommandService } from '@megumi/agent/commands';

describe('skill command integration', () => {
  it('returns an exact path selection from slash suggestions without encoding it in text', async () => {
    const skillPath = 'C:/workspace/.megumi/skills/checks/SKILL.md';
    const service = createCommandService({
      skills: [{ name: 'checks', skillPath, description: 'Run project checks', sourceLabel: 'User' }],
    });

    await expect(service.getCommandSuggestions({ draft_input: '/che' })).resolves.toMatchObject({
      type: 'suggestions',
      groups: [{ id: 'commands', items: [] }, {
        id: 'skills',
        items: [{
          name: 'checks',
          source: { kind: 'skill', name: 'checks', skillPath },
          display: { primary: 'checks', secondary: 'Run project checks', badge: 'User' },
          completion: {
            replacement_input: '',
            selection: { type: 'skill', name: 'checks', skillPath },
          },
        }],
      }],
    });
  });

  it('keeps distinct same-name skills when their SKILL.md paths differ', async () => {
    const service = createCommandService({
      skills: [
        { name: 'review', skillPath: 'C:/a/SKILL.md', description: 'Review A', sourceLabel: 'User' },
        { name: 'review', skillPath: 'C:/b/SKILL.md', description: 'Review B', sourceLabel: 'User' },
      ],
    });

    const result = await service.getCommandSuggestions({ draft_input: '/rev' });
    expect(result.type === 'suggestions' ? result.groups[1]?.items.map((item) => item.completion.selection) : []).toEqual([
      { type: 'skill', name: 'review', skillPath: 'C:/a/SKILL.md' },
      { type: 'skill', name: 'review', skillPath: 'C:/b/SKILL.md' },
    ]);
  });

  it('does not execute a suggestion display name as an implicit command', async () => {
    const service = createCommandService({
      skills: [{ name: 'check-project', skillPath: 'C:/a/SKILL.md', description: 'Check', sourceLabel: 'User' }],
    });
    await expect(service.handleCommandInput({ raw_input: '/check-project task' })).resolves.toEqual({
      type: 'not_command',
      raw_input: '/check-project task',
    });
  });
});
