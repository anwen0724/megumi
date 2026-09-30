/*
 * Persists device-local update preferences outside Product Settings.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DesktopRuntimeLogger } from '../runtime-logger';
import {
  ApplicationUpdatePreferencesSchema,
  type ApplicationUpdatePreferences,
} from '../../application-update/application-update-contract';

const DEFAULT_PREFERENCES: ApplicationUpdatePreferences = {
  automaticChecksEnabled: true,
};

export interface UpdatePreferencesStore {
  /** Reads validated preferences or safe defaults. */
  read(): ApplicationUpdatePreferences;
  /** Atomically persists the user's automatic-check preference. */
  write(preferences: ApplicationUpdatePreferences): void;
}

/** Creates the atomic JSON store under Megumi Home's Desktop-owned directory. */
export function createFileUpdatePreferencesStore(request: {
  readonly megumiHomePath: string;
  readonly logger: DesktopRuntimeLogger;
}): UpdatePreferencesStore {
  const filePath = path.join(request.megumiHomePath, 'desktop', 'application-update.json');
  return {
    read() {
      if (!fs.existsSync(filePath)) return DEFAULT_PREFERENCES;
      try {
        const parsed = ApplicationUpdatePreferencesSchema.safeParse(
          JSON.parse(fs.readFileSync(filePath, 'utf8')),
        );
        if (parsed.success) return parsed.data;
        request.logger.warn('application_update_preferences_invalid');
        return DEFAULT_PREFERENCES;
      } catch (error) {
        request.logger.warn('application_update_preferences_unreadable', { error: String(error) });
        return DEFAULT_PREFERENCES;
      }
    },
    write(preferences) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporaryFile = `${filePath}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(temporaryFile, `${JSON.stringify(preferences, null, 2)}\n`, 'utf8');
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
