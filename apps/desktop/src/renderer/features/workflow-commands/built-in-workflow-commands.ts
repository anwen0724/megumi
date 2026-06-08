import type { CommandDefinition } from '../../shared/commands';

export const BUILT_IN_WORKFLOW_COMMANDS: readonly CommandDefinition[] = [
  {
    name: 'review',
    kind: 'workflow',
    description: 'Review code in the current project',
  },
] as const;
