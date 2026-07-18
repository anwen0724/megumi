/*
 * Defines the runtime Skill model discovered from skill package directories.
 * Skill is not persisted as a database entity; availability and usage records are.
 */

export type SkillSourceKind = 'system' | 'user' | 'project';

export type SkillSource = {
  kind: SkillSourceKind;
  label: string;
  rootPath?: string;
};

export type SkillDiagnostic = {
  level: 'info' | 'warning' | 'error';
  message: string;
};

export type SkillResource = {
  resourcePath: string;
  contentType: 'text' | 'asset';
};

export type SkillScript = {
  name: string;
  scriptPath: string;
  description?: string;
};

export type Skill = {
  skillId: string;
  name: string;
  description: string;
  source: SkillSource;
  packagePath: string;
  content: string;
  resources: SkillResource[];
  scripts: SkillScript[];
  diagnostics: SkillDiagnostic[];
  available: boolean;
};
