import type {
  InputCommandDefinition,
  InputCommandKind,
  InputCommandSource,
  InputPromptSource,
} from '@megumi/shared';

export type CommandKind = InputCommandKind;
export type CommandSource = InputCommandSource;

export type CommandDefinition = InputCommandDefinition;

export interface CommandRegistry {
  localCommands?: readonly CommandDefinition[];
  intentCommands?: readonly CommandDefinition[];
  extensionCommands?: readonly CommandDefinition[];
  promptTemplateCommands?: readonly CommandDefinition[];
  skillCommands?: readonly CommandDefinition[];
}

export type CommandDispatchResult =
  | { kind: 'local_action'; command: CommandDefinition; rawText: string; argsText: string }
  | { kind: 'send_intent'; command: CommandDefinition; rawText: string; argsText: string }
  | { kind: 'extension_command'; command: CommandDefinition; rawText: string; argsText: string }
  | {
      kind: 'send_prompt';
      command: CommandDefinition;
      source: Extract<InputPromptSource, 'prompt_template' | 'skill'>;
      rawText: string;
      argsText: string;
    }
  | { kind: 'fallback'; rawText: string };
