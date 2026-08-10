/*
 * Owns Voice Profile identity, selection, and built-in/reference-audio source lifecycle facts.
 * Persistent file management will be supplied through the same public seam.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SpeechVoiceSource } from './speech';

export interface VoiceProfile {
  readonly profileId: string;
  readonly name: string;
  readonly source: SpeechVoiceSource;
  readonly language?: 'zh' | 'en';
  readonly gender?: 'female' | 'male';
  readonly builtIn: boolean;
}

export interface VoiceProfileSeed {
  readonly profileId: string;
  readonly name: string;
  readonly source: SpeechVoiceSource;
  readonly language?: 'zh' | 'en';
  readonly gender?: 'female' | 'male';
}

export interface ImportVoiceProfileRequest {
  readonly name: string;
  readonly sourceAudioPath: string;
}
export interface RenameVoiceProfileRequest { readonly profileId: string; readonly name: string }
export interface RemoveVoiceProfileRequest { readonly profileId: string }
export interface SelectVoiceProfileRequest { readonly profileId: string }

export type VoiceProfileListResult = { readonly status: 'ok'; readonly profiles: readonly VoiceProfile[] };
export type ImportVoiceProfileResult =
  | { readonly status: 'imported'; readonly profile: VoiceProfile }
  | { readonly status: 'already_exists'; readonly profileId: string };
export type RenameVoiceProfileResult =
  | { readonly status: 'renamed'; readonly profile: VoiceProfile }
  | { readonly status: 'not_found'; readonly profileId: string };
export type RemoveVoiceProfileResult =
  | { readonly status: 'removed'; readonly profileId: string }
  | { readonly status: 'not_found'; readonly profileId: string }
  | { readonly status: 'blocked'; readonly profileId: string; readonly reason: 'built_in' };
export type SelectVoiceProfileResult =
  | { readonly status: 'selected'; readonly profileId: string }
  | { readonly status: 'not_found'; readonly profileId: string };
export type VoiceProfileSelectionResult =
  | { readonly status: 'selected'; readonly profile: VoiceProfile }
  | { readonly status: 'unavailable' };

export interface VoiceProfiles {
  list(): VoiceProfileListResult;
  import(request: ImportVoiceProfileRequest): Promise<ImportVoiceProfileResult>;
  rename(request: RenameVoiceProfileRequest): RenameVoiceProfileResult;
  remove(request: RemoveVoiceProfileRequest): Promise<RemoveVoiceProfileResult>;
  select(request: SelectVoiceProfileRequest): SelectVoiceProfileResult;
  getSelected(): VoiceProfileSelectionResult;
}

interface StoredVoiceProfile {
  readonly profileId: string;
  readonly name: string;
  readonly referenceAudioPath: string;
}

interface StoredVoiceProfileCatalog {
  readonly selectedProfileId?: string;
  readonly profiles: readonly StoredVoiceProfile[];
}

export interface VoiceProfileStorage {
  load(): StoredVoiceProfileCatalog | undefined;
  importReferenceAudio(request: { readonly profileId: string; readonly sourceAudioPath: string }): string;
  save(catalog: StoredVoiceProfileCatalog): void;
  removeReferenceAudio(profileId: string): void;
}

export function createFileVoiceProfileStorage(options: { readonly profilesPath: string }): VoiceProfileStorage {
  const rootPath = path.resolve(options.profilesPath);
  const catalogPath = path.join(rootPath, 'profiles.json');

  return {
    load() {
      if (!fs.existsSync(catalogPath)) return undefined;
      const parsed: unknown = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      return parseStoredCatalog(parsed, rootPath);
    },
    importReferenceAudio(request) {
      const extension = path.extname(request.sourceAudioPath).toLowerCase() || '.wav';
      const profilePath = profileDirectoryPath(rootPath, request.profileId);
      fs.mkdirSync(profilePath, { recursive: true });
      const managedPath = path.join(profilePath, `reference${extension}`);
      fs.copyFileSync(request.sourceAudioPath, managedPath);
      return managedPath;
    },
    save(catalog) {
      fs.mkdirSync(rootPath, { recursive: true });
      const temporaryPath = `${catalogPath}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
      fs.renameSync(temporaryPath, catalogPath);
    },
    removeReferenceAudio(profileId) {
      fs.rmSync(profileDirectoryPath(rootPath, profileId), { recursive: true, force: true });
    },
  };
}

export function createVoiceProfiles(
  defaultProfile: VoiceProfileSeed,
  ids: { readonly createVoiceProfileId: () => string },
  storage?: VoiceProfileStorage,
  additionalBuiltInProfiles: readonly VoiceProfileSeed[] = [],
): VoiceProfiles {
  const profiles = new Map<string, VoiceProfile>();
  const builtInProfile: VoiceProfile = { ...defaultProfile, builtIn: true };
  profiles.set(builtInProfile.profileId, builtInProfile);
  for (const profile of additionalBuiltInProfiles) {
    profiles.set(profile.profileId, { ...profile, builtIn: true });
  }
  const stored = storage?.load();
  for (const profile of stored?.profiles ?? []) {
    profiles.set(profile.profileId, {
      profileId: profile.profileId,
      name: profile.name,
      source: { kind: 'reference_audio', referenceAudioPath: profile.referenceAudioPath },
      builtIn: false,
    });
  }
  let selectedProfileId = stored?.selectedProfileId && profiles.has(stored.selectedProfileId)
    ? stored.selectedProfileId
    : builtInProfile.profileId;

  const persist = () => storage?.save({
    selectedProfileId,
    profiles: [...profiles.values()]
      .filter((profile) => !profile.builtIn)
      .flatMap((profile) => profile.source.kind === 'reference_audio'
        ? [{ profileId: profile.profileId, name: profile.name, referenceAudioPath: profile.source.referenceAudioPath }]
        : []),
  });

  return {
    list: () => ({ status: 'ok', profiles: [...profiles.values()] }),
    async import(request) {
      const profileId = ids.createVoiceProfileId();
      const existing = profiles.get(profileId);
      if (existing) return { status: 'already_exists', profileId: existing.profileId };
      const referenceAudioPath = storage
        ? storage.importReferenceAudio({ profileId, sourceAudioPath: request.sourceAudioPath })
        : request.sourceAudioPath;
      const profile: VoiceProfile = {
        profileId,
        name: request.name,
        source: { kind: 'reference_audio', referenceAudioPath },
        builtIn: false,
      };
      profiles.set(profile.profileId, profile);
      persist();
      return { status: 'imported', profile };
    },
    rename(request) {
      const profile = profiles.get(request.profileId);
      if (!profile) return { status: 'not_found', profileId: request.profileId };
      const renamed = { ...profile, name: request.name };
      profiles.set(request.profileId, renamed);
      persist();
      return { status: 'renamed', profile: renamed };
    },
    async remove(request) {
      const profile = profiles.get(request.profileId);
      if (!profile) return { status: 'not_found', profileId: request.profileId };
      if (profile.builtIn) return { status: 'blocked', profileId: request.profileId, reason: 'built_in' };
      storage?.removeReferenceAudio(request.profileId);
      profiles.delete(request.profileId);
      if (selectedProfileId === request.profileId) selectedProfileId = builtInProfile.profileId;
      persist();
      return { status: 'removed', profileId: request.profileId };
    },
    select(request) {
      if (!profiles.has(request.profileId)) return { status: 'not_found', profileId: request.profileId };
      selectedProfileId = request.profileId;
      persist();
      return { status: 'selected', profileId: request.profileId };
    },
    getSelected() {
      const profile = profiles.get(selectedProfileId);
      return profile ? { status: 'selected', profile } : { status: 'unavailable' };
    },
  };
}

function profileDirectoryPath(rootPath: string, profileId: string): string {
  const directoryName = profileId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(rootPath, directoryName);
}

function parseStoredCatalog(value: unknown, rootPath: string): StoredVoiceProfileCatalog {
  if (!value || typeof value !== 'object') return { profiles: [] };
  const record = value as Record<string, unknown>;
  const profiles = Array.isArray(record.profiles)
    ? record.profiles.flatMap((entry): StoredVoiceProfile[] => {
        if (!entry || typeof entry !== 'object') return [];
        const profile = entry as Record<string, unknown>;
        if (
          typeof profile.profileId !== 'string'
          || typeof profile.name !== 'string'
          || typeof profile.referenceAudioPath !== 'string'
        ) return [];
        const referenceAudioPath = path.resolve(profile.referenceAudioPath);
        if (!isWithin(rootPath, referenceAudioPath)) return [];
        return [{ profileId: profile.profileId, name: profile.name, referenceAudioPath }];
      })
    : [];
  return {
    ...(typeof record.selectedProfileId === 'string' ? { selectedProfileId: record.selectedProfileId } : {}),
    profiles,
  };
}

function isWithin(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
