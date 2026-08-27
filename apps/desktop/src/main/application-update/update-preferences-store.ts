/*
 * Persists device-local update preferences outside Product Settings.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ApplicationUpdatePreferencesSchema,
  type ApplicationUpdatePreferences,
} from '../../application-update/application-update-contract';

const DEFAULT_PREFERENCES: ApplicationUpdatePreferences = {
  automaticChecksEnabled: true,
  automaticDownloadsEnabled: false,
};

export interface UpdatePreferencesStore {
  /** Reads validated preferences or safe defaults. */
  read(): ApplicationUpdatePreferences;
  /** Atomically persists a normalized preference pair. */
  write(preferences: ApplicationUpdatePreferences): void;
}

/** Creates the atomic JSON store under Megumi Home's Desktop-owned directory. */
export function createFileUpdatePreferencesStore(request: {
  readonly megumiHomePath: string;
}): UpdatePreferencesStore {
  const filePath = path.join(request.megumiHomePath, 'desktop', 'application-update.json');
  return {
    read() {
      if (!fs.existsSync(filePath)) return DEFAULT_PREFERENCES;
      try {
        const parsed = ApplicationUpdatePreferencesSchema.safeParse(
          JSON.parse(fs.readFileSync(filePath, 'utf8')),
        );
        return parsed.success ? normalizePreferences(parsed.data) : DEFAULT_PREFERENCES;
      } catch {
        return DEFAULT_PREFERENCES;
      }
    },
    write(preferences) {
      const normalized = normalizePreferences(ApplicationUpdatePreferencesSchema.parse(preferences));
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporaryFile = `${filePath}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(temporaryFile, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
        fs.renameSync(temporaryFile, filePath);
      } catch (error) {
        try {
          fs.rmSync(temporaryFile, { force: true });
        } catch {
          // Preserve the original write failure when temporary cleanup also fails.
        }
        throw error;
      }
    },
  };
}

function normalizePreferences(preferences: ApplicationUpdatePreferences): ApplicationUpdatePreferences {
  return preferences.automaticChecksEnabled
    ? preferences
    : { automaticChecksEnabled: false, automaticDownloadsEnabled: false };
}
