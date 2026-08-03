/*
 * Builds the immutable per-ModelCall SkillView: a bounded catalog for the system
 * prompt and diagnostics. Explicitly selected Skill content is expanded by Input
 * through resolveSelection() and never re-read here.
 *
 * Tools, Permissions and Sandbox never learn that a file is a Skill: dynamic Skill
 * reads go through the ordinary read_file flow with the ordinary workspace.read
 * Permission Operation and ordinary Sandbox rules.
 */

import type { Skill, SkillDiagnostic, SelectedSkillContent, SkillSelection, SkillsFailure } from './skill';
import { comparableSkillPath, type SkillsPolicy } from './skill-loader';

export interface SkillCatalogItem {
  readonly name: string;
  readonly description: string;
  readonly skillPath: string;
}

export interface SkillView {
  readonly catalog: readonly SkillCatalogItem[];
  readonly diagnostics: readonly SkillDiagnostic[];
}

export interface ResolveSkillSelectionRequest {
  readonly skillSelection: SkillSelection;
  readonly workspaceId?: string;
  readonly signal?: AbortSignal;
}

export type ResolveSkillSelectionResult =
  | { readonly status: 'ok'; readonly content: SelectedSkillContent }
  | { readonly status: 'failed'; readonly failure: SkillsFailure };

export interface CreateSkillViewRequest {
  readonly workspaceId?: string;
  readonly signal?: AbortSignal;
}

export type CreateSkillViewResult =
  | { readonly status: 'ok'; readonly view: SkillView }
  | { readonly status: 'failed'; readonly failure: SkillsFailure };

export function resolveSelectedSkill(input: {
  skills: readonly Skill[];
  skillSelection: SkillSelection;
}): { status: 'ok'; skill: Skill } | { status: 'failed'; failure: SkillsFailure } {
  const targetKey = comparableSkillPath(input.skillSelection.skillPath);
  const skill = input.skills.find((candidate) => comparableSkillPath(candidate.skillPath) === targetKey);
  if (!skill) {
    return {
      status: 'failed',
      failure: { code: 'skill_not_found', skillPath: input.skillSelection.skillPath },
    };
  }
  if (!skill.available) {
    return {
      status: 'failed',
      failure: { code: 'skill_unavailable', skillPath: skill.skillPath },
    };
  }
  if (skill.name !== input.skillSelection.name) {
    return {
      status: 'failed',
      failure: { code: 'skill_selection_changed', skillPath: skill.skillPath, name: skill.name },
    };
  }
  return { status: 'ok', skill };
}

export function buildSkillView(input: {
  skills: readonly Skill[];
  diagnostics: readonly SkillDiagnostic[];
  policy: Readonly<SkillsPolicy>;
}): { status: 'ok'; view: SkillView } {
  const diagnostics: SkillDiagnostic[] = [...input.diagnostics];
  const eligible = input.skills
    .filter((skill) => skill.available && !skill.disableModelInvocation)
    .sort((left, right) => left.name.localeCompare(right.name) || left.skillPath.localeCompare(right.skillPath));

  const catalog: SkillCatalogItem[] = [];
  for (const skill of eligible) {
    if (skill.description.length > input.policy.maxCatalogDescriptionCharacters) {
      diagnostics.push({
        level: 'warning',
        code: 'catalog_limited',
        message: `Skill description exceeds ${input.policy.maxCatalogDescriptionCharacters} characters and is omitted from the catalog: ${skill.skillPath}`,
      });
      continue;
    }
    if (catalog.length >= input.policy.maxCatalogItems) {
      diagnostics.push({
        level: 'warning',
        code: 'catalog_limited',
        message: `Skill catalog is limited to ${input.policy.maxCatalogItems} items; further Skills are omitted.`,
      });
      break;
    }
    catalog.push({ name: skill.name, description: skill.description, skillPath: skill.skillPath });
  }

  return {
    status: 'ok',
    view: {
      catalog,
      diagnostics,
    },
  };
}
