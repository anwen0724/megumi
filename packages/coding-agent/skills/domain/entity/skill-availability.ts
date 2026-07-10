/*
 * Defines the SkillAvailability entity backed by the skill_availability table.
 */

export type SkillAvailability = {
  skillAvailabilityId: string;
  skillId: string;
  workspaceId?: string;
  available: boolean;
  createdAt: string;
  updatedAt: string;
};
