/* Verifies the aggregated `/` suggestion query filters by prefix and stays inactive for non-slash drafts. */
import { describe, expect, it, vi } from 'vitest';
import { createInputSuggestionQuery } from '../../../packages/product/src/operations/session/input-suggestions';

function createQuery(input: {
  commands?: Array<{ name: string; aliases?: string[]; description: string; hiddenFromSuggestions?: boolean }>;
  skills?: Array<{ name: string; description: string; available: boolean; skillPath: string; owner: 'system' | 'user' }>;
}) {
  return createInputSuggestionQuery({
    commands: {
      list: () => (input.commands ?? []).map((command) => ({
        name: command.name,
        ...(command.aliases ? { aliases: command.aliases } : {}),
        description: command.description,
        ...(command.hiddenFromSuggestions !== undefined
          ? { hiddenFromSuggestions: command.hiddenFromSuggestions }
          : {}),
      })),
    },
    skills: {
      list: vi.fn(async () => ({
        status: 'ok' as const,
        skills: (input.skills ?? []).map((skill) => ({
          name: skill.name,
          description: skill.description,
          skillPath: skill.skillPath,
          packagePath: skill.skillPath.replace(/SKILL\.md$/, ''),
          source: { owner: skill.owner, scope: 'global' as const },
          content: '',
          disableModelInvocation: false,
          available: skill.available,
          diagnostics: [],
        })),
        diagnostics: [],
      })),
    },
  });
}

describe('createInputSuggestionQuery prefix filtering', () => {
  it('returns only commands whose name or alias matches the prefix', async () => {
    const query = createQuery({
      commands: [
        { name: 'compact', description: 'Compact the session context' },
        { name: 'clear', aliases: ['cls'], description: 'Clear the session' },
        { name: 'help', description: 'Show help' },
      ],
    });
    const result = await query.getInputSuggestions({ draftInput: '/com' });
    expect(result.type).toBe('suggestions');
    if (result.type !== 'suggestions') return;
    const commandGroup = result.groups.find((group) => group.id === 'commands');
    expect(commandGroup?.items.map((item) => item.name)).toEqual(['compact']);
  });

  it('matches a command through its alias', async () => {
    const query = createQuery({
      commands: [
        { name: 'clear', aliases: ['cls'], description: 'Clear the session' },
      ],
    });
    // 'clear' does not start with 'cls' as a whole word prefix; only the alias 'cls' matches.
    const result = await query.getInputSuggestions({ draftInput: '/cls' });
    expect(result.type).toBe('suggestions');
    if (result.type !== 'suggestions') return;
    const commandGroup = result.groups.find((group) => group.id === 'commands');
    expect(commandGroup?.items).toHaveLength(1);
    expect(commandGroup?.items[0]).toMatchObject({
      kind: 'command',
      name: 'clear',
      match: { field: 'alias', value: 'cls', prefix: 'cls' },
    });
  });

  it('returns only available Skills whose name matches the prefix', async () => {
    const query = createQuery({
      skills: [
        { name: 'review-code', description: 'Review code', available: true, skillPath: 'C:/s/review-code/SKILL.md', owner: 'user' },
        { name: 'brainstorming', description: 'Explore intent', available: true, skillPath: 'C:/s/brainstorming/SKILL.md', owner: 'system' },
        { name: 'disabled-skill', description: 'Disabled', available: false, skillPath: 'C:/s/disabled/SKILL.md', owner: 'user' },
      ],
    });
    const result = await query.getInputSuggestions({ draftInput: '/re' });
    expect(result.type).toBe('suggestions');
    if (result.type !== 'suggestions') return;
    const skillGroup = result.groups.find((group) => group.id === 'skills');
    expect(skillGroup?.items.map((item) => item.name)).toEqual(['review-code']);
    expect(skillGroup?.items[0]).toMatchObject({
      kind: 'skill',
      match: { field: 'name', value: 'review-code', prefix: 're' },
      selection: { type: 'skill', name: 'review-code', skillPath: 'C:/s/review-code/SKILL.md' },
    });
  });

  it('matches prefixes case-insensitively for commands and Skills', async () => {
    const query = createQuery({
      commands: [{ name: 'compact', description: 'Compact' }],
      skills: [
        { name: 'review-code', description: 'Review code', available: true, skillPath: 'C:/s/review-code/SKILL.md', owner: 'user' },
      ],
    });
    const upper = await query.getInputSuggestions({ draftInput: '/COMP' });
    expect(upper.type).toBe('suggestions');
    if (upper.type !== 'suggestions') return;
    expect(upper.groups.flatMap((group) => group.items).map((item) => item.name))
      .toEqual(['compact']);

    const skillUpper = await query.getInputSuggestions({ draftInput: '/Review' });
    expect(skillUpper.type).toBe('suggestions');
    if (skillUpper.type !== 'suggestions') return;
    expect(skillUpper.groups.flatMap((group) => group.items).map((item) => item.name))
      .toEqual(['review-code']);
  });

  it('returns no items when nothing matches the prefix', async () => {
    const query = createQuery({
      commands: [{ name: 'compact', description: 'Compact' }],
      skills: [{ name: 'review-code', description: 'Review', available: true, skillPath: 'C:/s/r/SKILL.md', owner: 'user' }],
    });
    const result = await query.getInputSuggestions({ draftInput: '/zzz' });
    expect(result.type).toBe('suggestions');
    if (result.type !== 'suggestions') return;
    expect(result.groups.flatMap((group) => group.items)).toHaveLength(0);
  });

  it('stays inactive for non-slash drafts and for drafts with trailing text after the command', async () => {
    const query = createQuery({
      commands: [{ name: 'compact', description: 'Compact' }],
    });
    expect(await query.getInputSuggestions({ draftInput: 'compact' })).toEqual({ type: 'inactive' });
    expect(await query.getInputSuggestions({ draftInput: '/comp act' })).toEqual({ type: 'inactive' });
  });

  it('hides hiddenFromSuggestions commands', async () => {
    const query = createQuery({
      commands: [
        { name: 'compact', description: 'Compact' },
        { name: 'secret', description: 'Hidden', hiddenFromSuggestions: true },
      ],
    });
    const result = await query.getInputSuggestions({ draftInput: '/s' });
    expect(result.type).toBe('suggestions');
    if (result.type !== 'suggestions') return;
    // 'secret' is hidden and 'compact' does not match the prefix: no command group is emitted.
    expect(result.groups.flatMap((group) => group.items)).toHaveLength(0);
  });
});
