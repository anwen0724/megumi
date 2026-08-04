/*
 * Owns the aggregated `/` input suggestions: Commands and Skills each provide
 * their own catalog facts, Product only combines them into the Host DTO.
 */

import type { CommandListItem, Commands } from '@megumi/commands';
import type { SkillSelection, Skills } from '@megumi/skills';

export interface CommandInputSuggestion {
  readonly kind: 'command';
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly argumentHint?: string;
  readonly match: {
    readonly field: 'name' | 'alias';
    readonly value: string;
    readonly prefix: string;
  };
  readonly replacementInput: string;
}

export interface SkillInputSuggestion {
  readonly kind: 'skill';
  readonly name: string;
  readonly description: string;
  readonly sourceLabel?: string;
  readonly match: {
    readonly field: 'name';
    readonly value: string;
    readonly prefix: string;
  };
  readonly replacementInput: string;
  readonly selection: SkillSelection;
}

export type InputSuggestionItem = CommandInputSuggestion | SkillInputSuggestion;
export type InputSuggestionQueryItem = InputSuggestionItem;

export interface InputSuggestionGroup {
  readonly id: 'commands' | 'skills';
  readonly label: string;
  readonly items: readonly InputSuggestionItem[];
}

export type InputSuggestionQueryResult =
  | { readonly type: 'inactive' }
  | {
      readonly type: 'suggestions';
      readonly draftInput: string;
      readonly queryPrefix: string;
      readonly groups: readonly InputSuggestionGroup[];
    };

export interface InputSuggestionQueryRequest {
  readonly draftInput: string;
  readonly workspaceId?: string;
}

export interface InputSuggestionQuery {
  getInputSuggestions(request: InputSuggestionQueryRequest): Promise<InputSuggestionQueryResult>;
}

export function createInputSuggestionQuery(options: {
  readonly commands: Pick<Commands, 'list'>;
  readonly skills: Pick<Skills, 'list'>;
}): InputSuggestionQuery {
  return {
    async getInputSuggestions(request) {
      if (!request.draftInput.trim().startsWith('/')) return { type: 'inactive' };
      // A draft with further text after the command name is no longer a
      // suggestion query; the slash line is already a concrete input.
      const queryPrefix = request.draftInput.trim().slice(1);
      if (/\s/.test(queryPrefix)) return { type: 'inactive' };
      const commandItems: CommandInputSuggestion[] = options.commands.list()
        .filter((command) => !command.hiddenFromSuggestions)
        .flatMap((command) => commandMatchesPrefix(command, queryPrefix));
      const skillResult = await options.skills.list({
        ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
      });
      const skillItems: SkillInputSuggestion[] = skillResult.status === 'ok'
        ? skillResult.skills
            .filter((skill) => skill.available && nameStartsWith(skill.name, queryPrefix))
            .map((skill) => ({
              kind: 'skill',
              name: skill.name,
              description: skill.description,
              ...(skill.source.owner === 'system' ? { sourceLabel: 'System' } : {}),
              match: {
                field: 'name',
                value: skill.name,
                prefix: queryPrefix,
              },
              replacementInput: '',
              selection: { type: 'skill', name: skill.name, skillPath: skill.skillPath },
            }))
        : [];
      const groups: InputSuggestionGroup[] = [];
      if (commandItems.length > 0) {
        groups.push({ id: 'commands', label: 'Commands', items: commandItems });
      }
      if (skillItems.length > 0) {
        groups.push({ id: 'skills', label: 'Skills', items: skillItems });
      }
      return {
        type: 'suggestions',
        draftInput: request.draftInput,
        queryPrefix,
        groups,
      };
    },
  };
}

/** Case-insensitive prefix match; the UI may display humanized names, so typing must not depend on letter case. */
function nameStartsWith(name: string, prefix: string): boolean {
  return name.toLowerCase().startsWith(prefix.toLowerCase());
}

/** Returns the suggestion when the command name or one of its aliases matches the prefix. */
function commandMatchesPrefix(
  command: CommandListItem,
  prefix: string,
): CommandInputSuggestion[] {
  if (nameStartsWith(command.name, prefix)) {
    return [commandSuggestion(command, { field: 'name', value: command.name, prefix })];
  }
  const alias = command.aliases?.find((candidate) => nameStartsWith(candidate, prefix));
  return alias
    ? [commandSuggestion(command, { field: 'alias', value: alias, prefix })]
    : [];
}

function commandSuggestion(
  command: CommandListItem,
  match: CommandInputSuggestion['match'],
): CommandInputSuggestion {
  return {
    kind: 'command',
    name: command.name,
    ...(command.aliases ? { aliases: [...command.aliases] } : {}),
    description: command.description,
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
    match,
    replacementInput: `/${command.name} `,
  };
}
