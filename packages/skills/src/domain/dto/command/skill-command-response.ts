/* Defines command-facing Skill descriptors without inventing a second identity. */

export type SkillCommandItem = {
  name: string;
  description: string;
  skillPath: string;
  sourceLabel: 'System' | 'User';
};

export type ListSkillCommandsResponse =
  | { status: 'ok'; commands: SkillCommandItem[] }
  | { status: 'failed'; message: string };
