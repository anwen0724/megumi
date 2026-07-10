/*
 * Defines UI and host-interface response DTOs for Skill operations.
 */

import type { SkillDiagnostic } from '../../model/skill';

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
