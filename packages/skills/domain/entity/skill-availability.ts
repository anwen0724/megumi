/* Defines the only durable Skill setting: availability for one exact SKILL.md path. */

export type SkillAvailability = {
  skillAvailabilityId: string;
  skillPath: string;
  available: boolean;
  updatedAt: string;
};
