// Controller for artifact operations exposed to UI shells.
import type {
  ArtifactGetData,
  ArtifactListData,
  ArtifactReferenceData,
  ArtifactReferencePayload,
  ArtifactStatusUpdateData,
  ArtifactStatusUpdatePayload,
  ArtifactVersionCreateData,
  ArtifactVersionCreatePayload,
  ArtifactVersionGetData,
} from '@megumi/shared/ipc';
import type { JsonObject } from '@megumi/shared/primitives';
import type { ArtifactServicePort } from '../../artifacts';

export interface ArtifactController {
  listByRun(runId: string): ArtifactListData;
  listBySession(sessionId: string): ArtifactListData;
  get(artifactId: string): ArtifactGetData;
  getVersion(artifactVersionId: string): ArtifactVersionGetData;
  createVersion(payload: ArtifactVersionCreatePayload): Promise<ArtifactVersionCreateData>;
  updateStatus(payload: ArtifactStatusUpdatePayload): ArtifactStatusUpdateData;
  reference(payload: ArtifactReferencePayload): ArtifactReferenceData;
}

export function createArtifactController(
  artifactService: ArtifactServicePort,
): ArtifactController {
  return {
    listByRun: (runId) => ({ artifacts: artifactService.listByRun(runId) }),
    listBySession: (sessionId) => ({ artifacts: artifactService.listBySession(sessionId) }),
    get: (artifactId) => ({
      ...artifactService.get(artifactId),
      relations: [],
    }),
    getVersion: (artifactVersionId) => ({ version: artifactService.getVersion(artifactVersionId) }),
    createVersion: async (payload) => ({
      version: await artifactService.createVersion({
        ...payload,
        metadata: payload.metadata as JsonObject | undefined,
      }),
    }),
    updateStatus: (payload) => ({ artifact: artifactService.updateStatus(payload) }),
    reference: (payload) => ({
      sourceRef: artifactService.reference({
        ...payload,
        metadata: payload.metadata as JsonObject | undefined,
      }),
    }),
  };
}
