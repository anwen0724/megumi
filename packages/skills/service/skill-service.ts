/* Defines the single public business API of one Root-bound Skills snapshot. */

import type {
  DisableSkillRequest,
  DisableSkillResponse,
  DeleteSkillRequest,
  DeleteSkillResponse,
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
  UseSkillRequest,
  UseSkillResponse,
} from './skill-service-types';

export interface SkillService {
  listSkills(request: ListSkillsRequest): Promise<ListSkillsResponse>;
  getSkill(request: GetSkillRequest): Promise<GetSkillResponse>;
  enableSkill(request: EnableSkillRequest): Promise<EnableSkillResponse>;
  disableSkill(request: DisableSkillRequest): Promise<DisableSkillResponse>;
  deleteSkill(request: DeleteSkillRequest): Promise<DeleteSkillResponse>;
  getSkillCatalog(request: GetSkillCatalogRequest): Promise<GetSkillCatalogResponse>;
  useSkill(request: UseSkillRequest): Promise<UseSkillResponse>;
  readSkillResource(request: ReadSkillResourceRequest): Promise<ReadSkillResourceResponse>;
  listSkillScripts(request: ListSkillScriptsRequest): Promise<ListSkillScriptsResponse>;
  prepareSkillScriptExecution(request: PrepareSkillScriptExecutionRequest): Promise<PrepareSkillScriptExecutionResponse>;
}
