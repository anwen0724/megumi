export type CommandKind = 'local' | 'prompt_expansion' | 'workflow';

export interface CommandDefinition {
  name: string;
  kind: CommandKind;
  description: string;
}

export type CommandDispatchResult =
  | { kind: 'local'; command: CommandDefinition; rawText: string; argsText: string }
  | { kind: 'prompt_expansion'; command: CommandDefinition; rawText: string; argsText: string }
  | { kind: 'workflow'; command: CommandDefinition; rawText: string; argsText: string }
  | { kind: 'fallback'; rawText: string };
