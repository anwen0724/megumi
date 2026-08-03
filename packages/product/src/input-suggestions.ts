/*
 * Owns the aggregated `/` input suggestions: Commands and Skills each provide
 * their own catalog facts, Product only combines them into the Host DTO.
 */

import type { Commands } from '@megumi/commands';
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
      const queryPrefix = request.draftInput.trim().slice(1);
      const commandItems: CommandInputSuggestion[] = options.commands.list().map((command) => ({
        kind: 'command',
        name: command.name,
        ...(command.aliases ? { aliases: [...command.aliases] } : {}),
        description: command.description,
        ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
        match: {
          field: 'name',
          value: command.name,
          prefix: queryPrefix,
        },
        replacementInput: `/${command.name} `,
      }));
      const skillResult = await options.skills.list({
        ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
      });
      const skillItems: SkillInputSuggestion[] = skillResult.status === 'ok'
        ? skillResult.skills.filter((skill) => skill.available).map((skill) => ({
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
