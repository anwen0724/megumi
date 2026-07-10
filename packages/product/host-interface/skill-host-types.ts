/*
 * Defines UI and host-interface request DTOs for Skill operations.
 */
import type { SkillDiagnostic } from '../../coding-agent/skills/domain/model/skill';

export type ListSkillsUiRequest = {
  workspaceId?: string;
};

export type GetSkillDetailUiRequest = {
  skillId: string;
  workspaceId?: string;
};

export type EnableSkillUiRequest = {
  skillId: string;
  workspaceId?: string;
};

export type DisableSkillUiRequest = {
  skillId: string;
  workspaceId?: string;
  reason?: string;
};

export type SkillDiagnosticUiItem = SkillDiagnostic;

export type SkillListUiItem = {
  skillId: string;
  name: string;
  description: string;
  sourceLabel: string;
  available: boolean;
  hasResources: boolean;
  hasScripts: boolean;
  diagnostics: SkillDiagnosticUiItem[];
};

export type SkillDetailUiDto = SkillListUiItem & {
  content?: string;
  resourcePaths: string[];
  scriptNames: string[];
};

export type ListSkillsUiResponse =
  | { status: 'ok'; skills: SkillListUiItem[] }
  | { status: 'failed'; message: string };

export type GetSkillDetailUiResponse =
  | { status: 'ok'; skill: SkillDetailUiDto }
  | { status: 'not_found'; skillId: string }
  | { status: 'failed'; message: string };

export type EnableSkillUiResponse =
  | { status: 'ok'; skillId: string }
  | { status: 'not_found'; skillId: string }
  | { status: 'failed'; message: string };

export type DisableSkillUiResponse =
  | { status: 'ok'; skillId: string }
  | { status: 'not_found'; skillId: string }
  | { status: 'failed'; message: string };
