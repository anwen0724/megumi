/* Defines filesystem-discovered Skill facts owned by the standalone Skills package. */

export type SkillOwner = 'system' | 'user';

export type SkillSource = {
  owner: SkillOwner;
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
  name: string;
  description: string;
  skillPath: string;
  source: SkillSource;
  content: string;
  resources: SkillResource[];
  scripts: SkillScript[];
  diagnostics: SkillDiagnostic[];
  available: boolean;
};
