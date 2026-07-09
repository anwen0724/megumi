/*
 * Defines Command module response DTOs for slash skill entrypoints.
 */

export type SkillCommandItem = {
  skillId: string;
  commandName: string;
  skillName: string;
  description: string;
  sourceLabel: string;
  completionInput: string;
};

export type ListSkillCommandsResponse =
  | { status: 'ok'; commands: SkillCommandItem[] }
  | { status: 'failed'; message: string };

export type ExecuteSkillCommandResponse =
  | {
      status: 'agent_run';
      skillId: string;
      argumentsInput: string;
      requestedSkillActivation: {
        skillId: string;
        trigger: 'command';
      };
    }
  | { status: 'not_found'; skillId: string }
  | { status: 'unavailable'; skillId: string }
  | { status: 'failed'; message: string };
