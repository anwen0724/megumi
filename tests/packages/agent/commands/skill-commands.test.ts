import { describe, expect, it, vi } from 'vitest';
import { createSkillCommands } from '@megumi/agent/commands/core/skill-commands';

describe('createSkillCommands', () => {
  it('creates one stable name-based command and path-addressed suggestions', () => {
    const skillPath = 'C:/home/.megumi/skills/.system/brainstorming/SKILL.md';
    const commands = createSkillCommands({
      skills: [{ name: 'brainstorming', skillPath, description: 'Explore intent', sourceLabel: 'System' }],
    });

    expect(commands.map(({ name, description, source, suggestion }) => ({ name, description, source, suggestion }))).toEqual([
      {
        name: 'skill',
        description: 'Use a skill by its name',
        source: { kind: 'built_in' },
        suggestion: undefined,
      },
      {
        name: 'brainstorming',
        description: 'Explore intent',
        source: { kind: 'skill', name: 'brainstorming', skillPath },
        suggestion: {
          source_badge: 'System',
          replacement_input: '',
          primary: 'brainstorming',
          secondary: 'Explore intent',
          badge: 'System',
        },
      },
    ]);
  });

  it('resolves /skill by a unique name through the run-bound Skill service', async () => {
    const skillPath = 'C:/user/skills/review/SKILL.md';
    const [command] = createSkillCommands();
    const listSkills = vi.fn(async () => ({
      status: 'ok' as const,
      skills: [{ name: 'review', skillPath, available: true }],
    }));

    await expect(command!.execute({
      invocation: { name: 'skill', arguments_input: 'review check this', raw_input: '/skill review check this' },
      execution_context: { session_id: 'session:1', services: { skills: { listSkills } as never } },
    })).resolves.toEqual({
      type: 'agent_run',
      input: {
        raw_input: 'check this',
        requestedSkill: { type: 'skill', name: 'review', skillPath },
        command: {
          name: 'skill',
          source: { kind: 'skill', name: 'review', skillPath },
          arguments_input: 'check this',
        },
      },
    });
  });

  it('rejects ambiguous same-name skills so the UI must preserve the selected path', async () => {
    const [command] = createSkillCommands();
    const listSkills = vi.fn(async () => ({
      status: 'ok' as const,
      skills: [
        { name: 'review', skillPath: 'C:/a/SKILL.md', available: true },
        { name: 'review', skillPath: 'C:/b/SKILL.md', available: true },
      ],
    }));

    await expect(command!.execute({
      invocation: { name: 'skill', arguments_input: 'review', raw_input: '/skill review' },
      execution_context: { session_id: 'session:1', services: { skills: { listSkills } as never } },
    })).resolves.toEqual({
      type: 'error',
      message: 'Skill name is ambiguous: review. Select it from the / menu.',
    });
  });
});
