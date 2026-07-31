/* Defines the exact Skill selection passed from user-facing task entrypoints. */

export type SkillSelection = {
  type: 'skill';
  name: string;
  skillPath: string;
};
