/* Defines the Product Home root selection and its stable directory layout. */
import path from 'node:path';

export interface MegumiHomeEnv {
  readonly MEGUMI_HOME?: string;
}

export interface MegumiHomePaths {
  readonly homePath: string;
  readonly skillsPath: string;
  readonly systemSkillsPath: string;
  readonly settingsPath: string;
  readonly settingsSchemaPath: string;
  readonly readmePath: string;
  readonly versionPath: string;
  readonly sqlitePath: string;
  readonly logsPath: string;
  readonly cachePath: string;
  readonly tmpPath: string;
  readonly attachmentsPath: string;
  readonly voicePath: string;
  readonly modelsPath: string;
  readonly voiceModelsPath: string;
  readonly voiceProfilesPath: string;
  readonly voiceCachePath: string;
  readonly voiceTmpPath: string;
}

export interface ResolveMegumiHomePathOptions {
  readonly env: MegumiHomeEnv;
  readonly homeDirectory: string;
}

/** Resolves the configured Product Home without touching the filesystem. */
export function resolveMegumiHomePath(options: ResolveMegumiHomePathOptions): string {
  const override = options.env.MEGUMI_HOME?.trim();
  return path.resolve(override || options.homeDirectory, override ? '' : '.megumi');
}

/** Builds all Product Home paths from one already-resolved root. */
export function buildMegumiHomePaths(homePath: string): MegumiHomePaths {
  const resolvedHomePath = path.resolve(homePath);
  return {
    homePath: resolvedHomePath,
    skillsPath: path.join(resolvedHomePath, 'skills'),
    systemSkillsPath: path.join(resolvedHomePath, 'skills', '.system'),
    settingsPath: path.join(resolvedHomePath, 'settings.json'),
    settingsSchemaPath: path.join(resolvedHomePath, 'settings.schema.json'),
    readmePath: path.join(resolvedHomePath, 'README.md'),
    versionPath: path.join(resolvedHomePath, 'version.json'),
    sqlitePath: path.join(resolvedHomePath, 'sqlite'),
    logsPath: path.join(resolvedHomePath, 'logs'),
    cachePath: path.join(resolvedHomePath, 'cache'),
    tmpPath: path.join(resolvedHomePath, 'tmp'),
    attachmentsPath: path.join(resolvedHomePath, 'attachments'),
    voicePath: path.join(resolvedHomePath, 'voice'),
    modelsPath: path.join(resolvedHomePath, 'models'),
    voiceModelsPath: path.join(resolvedHomePath, 'models', 'voice'),
    voiceProfilesPath: path.join(resolvedHomePath, 'voice', 'profiles'),
    voiceCachePath: path.join(resolvedHomePath, 'cache', 'voice'),
    voiceTmpPath: path.join(resolvedHomePath, 'tmp', 'voice'),
  };
}
