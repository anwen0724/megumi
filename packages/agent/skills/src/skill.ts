/*
 * Defines the shared Skill models owned by the Skills package: discovered Skill facts,
 * source identity, user selection, diagnostics, availability, and management DTOs.
 *
 * skillPath is the single local identity of a Skill; no sourceId, packageId or remote
 * authority exists. Source is assigned by the Root that discovered the Skill, never
 * inferred from path strings.
 */

export type SkillOwner = 'system' | 'user';

export type SkillScope = 'global' | 'workspace';

export interface SkillSource {
  readonly owner: SkillOwner;
  readonly scope: SkillScope;
  readonly workspaceId?: string;
}

export type SkillDiagnosticLevel = 'info' | 'warning' | 'error';

export type SkillDiagnosticCode =
  | 'manifest_invalid_yaml'
  | 'manifest_missing_description'
  | 'manifest_name_invalid'
  | 'manifest_name_fallback'
  | 'skill_unreadable'
  | 'skill_manifest_too_large'
  | 'skill_content_too_large'
  | 'root_unreadable'
  | 'scan_limited'
  | 'name_conflict'
  | 'catalog_limited'
  | 'refresh_failed';

export interface SkillDiagnostic {
  readonly level: SkillDiagnosticLevel;
  readonly code: SkillDiagnosticCode;
  readonly message: string;
}

export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly skillPath: string;
  readonly packagePath: string;
  readonly source: SkillSource;
  readonly content: string;
  readonly disableModelInvocation: boolean;
  readonly available: boolean;
  readonly diagnostics: readonly SkillDiagnostic[];
}

export interface SkillSelection {
  readonly type: 'skill';
  readonly name: string;
  readonly skillPath: string;
}

export interface SelectedSkillContent {
  readonly name: string;
  readonly skillPath: string;
  readonly packagePath: string;
  readonly content: string;
}

/** The only durable user setting for a Skill, keyed by normalized skillPath. */
export interface SkillAvailability {
  readonly skillPath: string;
  readonly available: boolean;
  readonly updatedAt: string;
}

/** Management-view package overview; never a model-facing execution contract. */
export interface SkillPackageOverview {
  readonly name: string;
  readonly description: string;
  readonly skillPath: string;
  readonly packagePath: string;
  readonly source: SkillSource;
  readonly available: boolean;
  readonly disableModelInvocation: boolean;
  readonly hasReferences: boolean;
  readonly hasAssets: boolean;
  readonly hasScripts: boolean;
}

export type SkillsFailure =
  | { readonly code: 'skills_unavailable'; readonly message: string }
  | { readonly code: 'skill_not_found'; readonly skillPath: string }
  | { readonly code: 'skill_unavailable'; readonly skillPath: string }
  | { readonly code: 'skill_invalid'; readonly skillPath: string; readonly diagnostics: readonly SkillDiagnostic[] }
  | { readonly code: 'skill_selection_changed'; readonly skillPath: string; readonly name: string }
  | { readonly code: 'delete_not_allowed'; readonly skillPath: string; readonly reason: 'system_skill' | 'skill_root' }
  | { readonly code: 'cancelled' }
  | { readonly code: 'internal'; readonly message: string };

export function skillsFailureMessage(failure: SkillsFailure): string {
  switch (failure.code) {
    case 'skills_unavailable':
      return failure.message;
    case 'skill_not_found':
      return `Skill was not found: ${failure.skillPath}`;
    case 'skill_unavailable':
      return `Skill is unavailable: ${failure.skillPath}`;
    case 'skill_invalid':
      return `Skill is invalid: ${failure.skillPath}`;
    case 'skill_selection_changed':
      return `Skill selection is stale: ${failure.skillPath} is now named ${failure.name}.`;
    case 'delete_not_allowed':
      return failure.reason === 'system_skill'
        ? 'System Skills cannot be deleted.'
        : 'The Skill Root itself cannot be deleted.';
    case 'cancelled':
      return 'Skills operation was cancelled.';
    case 'internal':
      return failure.message;
  }
}

export class SkillsCancelledError extends Error {
  constructor() {
    super('Skills operation was cancelled.');
    this.name = 'SkillsCancelledError';
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new SkillsCancelledError();
  }
}
