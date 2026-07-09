/*
 * Defines the SkillService interface as the single public business entrypoint.
 */

import type {
  ActivateSkillRequest,
  ActivateSkillResponse,
  DisableSkillRequest,
  DisableSkillResponse,
  EnableSkillRequest,
  EnableSkillResponse,
  GetSkillCatalogRequest,
  GetSkillCatalogResponse,
  GetSkillRequest,
  GetSkillResponse,
  ListSkillScriptsRequest,
  ListSkillScriptsResponse,
  ListSkillsRequest,
  ListSkillsResponse,
  PrepareSkillScriptExecutionRequest,
  PrepareSkillScriptExecutionResponse,
  ReadSkillResourceRequest,
  ReadSkillResourceResponse,
} from './skill-service-types';

export interface SkillService {
  listSkills(request: ListSkillsRequest): Promise<ListSkillsResponse>;
  getSkill(request: GetSkillRequest): Promise<GetSkillResponse>;
  enableSkill(request: EnableSkillRequest): Promise<EnableSkillResponse>;
  disableSkill(request: DisableSkillRequest): Promise<DisableSkillResponse>;
  getSkillCatalog(request: GetSkillCatalogRequest): Promise<GetSkillCatalogResponse>;
  activateSkill(request: ActivateSkillRequest): Promise<ActivateSkillResponse>;
  readSkillResource(request: ReadSkillResourceRequest): Promise<ReadSkillResourceResponse>;
  listSkillScripts(request: ListSkillScriptsRequest): Promise<ListSkillScriptsResponse>;
  prepareSkillScriptExecution(
    request: PrepareSkillScriptExecutionRequest,
  ): Promise<PrepareSkillScriptExecutionResponse>;
}
