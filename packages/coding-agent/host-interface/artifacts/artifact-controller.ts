/*
 * Controller for artifact operations exposed to UI shells.
 */
import type { ArtifactServicePort } from '../../artifacts';

export type ArtifactRecord = ReturnType<ArtifactServicePort['listByRun']>[number];
export type ArtifactVersionRecord = NonNullable<ReturnType<ArtifactServicePort['getVersion']>>;
export type ArtifactSourceRefRecord = ReturnType<ArtifactServicePort['get']>['sourceRefs'][number];
export type ArtifactCreateVersionPayload = Parameters<ArtifactServicePort['createVersion']>[0];
export type ArtifactStatusUpdatePayload = Parameters<ArtifactServicePort['updateStatus']>[0];
export type ArtifactReferencePayload = Parameters<ArtifactServicePort['reference']>[0];

export interface ArtifactListData {
  artifacts: ArtifactRecord[];
}

export interface ArtifactGetData {
  artifact: ArtifactRecord | undefined;
  currentVersion: ArtifactVersionRecord | undefined;
  sourceRefs: ArtifactSourceRefRecord[];
  relations: unknown[];
}

export interface ArtifactVersionGetData {
  version: ArtifactVersionRecord | undefined;
}

export interface ArtifactVersionCreateData {
  version: ArtifactVersionRecord;
}

export interface ArtifactStatusUpdateData {
  artifact: ArtifactRecord;
}

export interface ArtifactReferenceData {
  sourceRef: ArtifactSourceRefRecord;
}

export interface ArtifactController {
  listByRun(runId: string): ArtifactListData;
  listBySession(sessionId: string): ArtifactListData;
  get(artifactId: string): ArtifactGetData;
  getVersion(artifactVersionId: string): ArtifactVersionGetData;
  createVersion(payload: ArtifactCreateVersionPayload): Promise<ArtifactVersionCreateData>;
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
    createVersion: async (payload) => ({ version: await artifactService.createVersion(payload) }),
    updateStatus: (payload) => ({ artifact: artifactService.updateStatus(payload) }),
    reference: (payload) => ({ sourceRef: artifactService.reference(payload) }),
  };
}
