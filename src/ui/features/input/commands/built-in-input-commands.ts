// Defines Megumi-owned input commands that the renderer can suggest before runtime validation.
import type { CommandDefinition, CommandRegistry } from '../../../shared/commands';

export const BUILT_IN_INTENT_COMMANDS: readonly CommandDefinition[] = [
  {
    name: 'review',
    kind: 'intent',
    source: 'core',
    description: 'Review code in the current project',
  },
] as const;

export const BUILT_IN_PROMPT_TEMPLATE_COMMANDS: readonly CommandDefinition[] = [
  {
    name: 'summary',
    kind: 'prompt_template',
    source: 'core',
    description: 'Summarize the current session',
    argumentHint: '[focus]',
  },
] as const;

export const BUILT_IN_SKILL_COMMANDS: readonly CommandDefinition[] = [
  {
    name: 'write-doc',
    kind: 'skill',
    source: 'core',
    description: 'Write or update project documentation',
    argumentHint: '[target]',
  },
] as const;

export const BUILT_IN_INPUT_COMMAND_REGISTRY: CommandRegistry = {
  intentCommands: BUILT_IN_INTENT_COMMANDS,
  promptTemplateCommands: BUILT_IN_PROMPT_TEMPLATE_COMMANDS,
  skillCommands: BUILT_IN_SKILL_COMMANDS,
};
