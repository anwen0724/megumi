import { describe, expect, it } from 'vitest';
import { createCommandService } from '@megumi/coding-agent/commands';

describe('skill command integration', () => {
  it('routes explicit /skill commands to agent_run with requested activation', async () => {
    const service = createCommandService({
      skills: [{
        skillId: 'checks:test',
        commandName: 'test',
        skillName: 'checks:test',
        description: 'Run project checks',
        sourceLabel: 'Project',
      }],
    });

    await expect(service.handleCommandInput({
      raw_input: '/skill checks:test --watch',
    })).resolves.toEqual({
      type: 'agent_run',
      input: {
        raw_input: '/skill checks:test --watch',
        requestedSkillActivation: {
          skillId: 'checks:test',
          trigger: 'command',
        },
        command: {
          name: 'skill',
          source: { kind: 'skill', skill_id: 'checks:test' },
          arguments_input: '--watch',
        },
      },
    });
  });

  it('rejects /skill without a skillId', async () => {
    const service = createCommandService();

    await expect(service.handleCommandInput({ raw_input: '/skill' })).resolves.toEqual({
      type: 'error',
      message: 'Usage: /skill <skillId> [args]',
    });
  });

  it('does not execute natural skill command names', async () => {
    const service = createCommandService({
      skills: [{
        skillId: 'superpowers:brainstorming',
        commandName: 'brainstorming',
        skillName: 'superpowers:brainstorming',
        description: 'Explore intent before implementation',
        sourceLabel: 'System',
      }],
    });

    await expect(service.handleCommandInput({ raw_input: '/brainstorming' })).resolves.toEqual({
      type: 'not_command',
      raw_input: '/brainstorming',
    });
  });

  it('suggests skill display names but completes stable /skill input', () => {
    const service = createCommandService({
      skills: [{
        skillId: 'superpowers:brainstorming',
        commandName: 'brainstorming',
        skillName: 'superpowers:brainstorming',
        description: 'Explore intent before implementation',
        sourceLabel: 'System',
      }],
    });

    expect(service.getCommandSuggestions({ draft_input: '/br' })).toMatchObject({
      type: 'suggestions',
      groups: [{
        id: 'commands',
        items: [],
      }, {
        id: 'skills',
        items: [{
          name: 'brainstorming',
          display: {
            primary: 'brainstorming',
            secondary: 'superpowers:brainstorming - Explore intent before implementation',
            badge: 'System',
          },
          completion: { replacement_input: '/skill superpowers:brainstorming ' },
        }],
      }],
    });
  });

  it('shows same-priority same display names as distinct skill suggestions', () => {
    const service = createCommandService({
      skills: [{
        skillId: 'packages-a:test',
        commandName: 'test',
        skillName: 'packages-a:test',
        description: 'Run tests for package A',
        sourceLabel: 'Project',
      }, {
        skillId: 'packages-b:test',
        commandName: 'test',
        skillName: 'packages-b:test',
        description: 'Run tests for package B',
        sourceLabel: 'Project',
      }],
    });

    const suggestions = service.getCommandSuggestions({ draft_input: '/te' });
    expect(suggestions.type === 'suggestions' ? suggestions.groups[1]?.items.map((item) => ({
      name: item.name,
      secondary: item.display?.secondary,
      badge: item.display?.badge,
      replacement: item.completion.replacement_input,
    })) : []).toEqual([{
      name: 'test',
      secondary: 'packages-a:test - Run tests for package A',
      badge: 'Project',
      replacement: '/skill packages-a:test ',
    }, {
      name: 'test',
      secondary: 'packages-b:test - Run tests for package B',
      badge: 'Project',
      replacement: '/skill packages-b:test ',
    }]);
  });
});
