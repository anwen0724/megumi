/* Persists update facts, separately from preferences and the library-owned installer cache. */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ApplicationUpdateReleaseSchema } from '../../application-update/application-update-contract';
import type { DesktopRuntimeLogger } from '../runtime-logger';

export const UpdateArtifactSchema = z.object({
  url: z.string().url(),
  fileName: z.string().regex(/^[^<>:"/\\|?*\x00-\x1f]+\.exe$/i),
  sha512: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  size: z.number().int().positive().optional(),
  isAdminRightsRequired: z.boolean(),
}).strict();
export const UpdateCandidateSchema = z.object({
  release: ApplicationUpdateReleaseSchema,
  artifact: UpdateArtifactSchema,
}).strict();
export type UpdateCandidate = z.infer<typeof UpdateCandidateSchema>;
const UpdateStateSchema = z.object({
  schemaVersion: z.literal(1),
  sourceKey: z.string().min(1),
  checkedAt: z.string().datetime(),
  candidate: UpdateCandidateSchema,
  downloadRequested: z.boolean(),
  downloadedAt: z.string().datetime().optional(),
}).strict();
export type UpdateState = z.infer<typeof UpdateStateSchema>;

export interface UpdateStateStore {
  read(): UpdateState | undefined;
  write(state: UpdateState | undefined): void;
}

/** Stores a small atomic record in Home; never touches the updater cache. */
export function createFileUpdateStateStore(request: {
  megumiHomePath: string; logger: DesktopRuntimeLogger;
}): UpdateStateStore {
  const file = path.join(request.megumiHomePath, 'desktop', 'application-update-state.json');
  return {
    read() {
      if (!fs.existsSync(file)) return undefined;
      try {
        return UpdateStateSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
      } catch (error) {
        request.logger.warn('application_update_state_unreadable', { error: String(error) });
        return undefined;
      }
    },
    write(state) {
      if (!state) { fs.rmSync(file, { force: true }); return; }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporaryFile = `${file}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(temporaryFile, `${JSON.stringify(UpdateStateSchema.parse(state), null, 2)}\n`, 'utf8');
        fs.renameSync(temporaryFile, file);
      } finally {
        fs.rmSync(temporaryFile, { force: true });
      }
    },
  };
}
