/* Maps Desktop-facing Skill management requests to the long-lived Skills module. */
import {
  buildSkillPackageOverview,
  skillsFailureMessage,
  type Skill,
  type Skills,
  type SkillsFailure,
} from '@megumi/skills';
import { z } from 'zod';

export interface SkillHost {
  listSkills(request: ListSkillsUiRequest): Promise<ListSkillsUiResponse>;
  getSkillDetail(request: GetSkillDetailUiRequest): Promise<GetSkillDetailUiResponse>;
  enableSkill(request: EnableSkillUiRequest): Promise<EnableSkillUiResponse>;
  disableSkill(request: DisableSkillUiRequest): Promise<DisableSkillUiResponse>;
  deleteSkill(request: DeleteSkillUiRequest): Promise<DeleteSkillUiResponse>;
  refreshSkills(request: RefreshSkillsUiRequest): Promise<RefreshSkillsUiResponse>;
}

export const SkillListPayloadSchema = z.object({ workspaceId: z.string().min(1).optional() }).strict();
export const SkillGetPayloadSchema = z.object({
  skillPath: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
}).strict();
export const SkillEnablePayloadSchema = SkillGetPayloadSchema;
export const SkillDisablePayloadSchema = SkillGetPayloadSchema;
export const SkillDeletePayloadSchema = SkillGetPayloadSchema;
export const SkillRefreshPayloadSchema = SkillListPayloadSchema;

const SkillDiagnosticUiItemSchema = z.object({
  level: z.enum(['info', 'warning', 'error']),
  message: z.string(),
}).strict();
const SkillListUiItemSchema = z.object({
  name: z.string(),
  description: z.string(),
  skillPath: z.string().min(1),
  sourceLabel: z.enum(['System', 'User']),
  available: z.boolean(),
  hasResources: z.boolean(),
  hasScripts: z.boolean(),
  diagnostics: z.array(SkillDiagnosticUiItemSchema),
}).strict();
const SkillDetailUiDtoSchema = SkillListUiItemSchema.extend({
  content: z.string().optional(),
  resourcePaths: z.array(z.string()),
  scriptNames: z.array(z.string()),
}).strict();
const SkillMutationUiResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), skillPath: z.string().min(1) }).strict(),
  z.object({ status: z.literal('not_found'), skillPath: z.string().min(1) }).strict(),
  z.object({ status: z.literal('failed'), failure: z.object({ code: z.string(), message: z.string() }).strict() }).strict(),
]);

export const ListSkillsUiResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), skills: z.array(SkillListUiItemSchema) }).strict(),
  z.object({ status: z.literal('failed'), failure: z.object({ code: z.string(), message: z.string() }).strict() }).strict(),
]);
export const GetSkillDetailUiResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), skill: SkillDetailUiDtoSchema }).strict(),
  z.object({ status: z.literal('not_found'), skillPath: z.string().min(1) }).strict(),
  z.object({ status: z.literal('failed'), failure: z.object({ code: z.string(), message: z.string() }).strict() }).strict(),
]);
export const EnableSkillUiResponseSchema = SkillMutationUiResponseSchema;
export const DisableSkillUiResponseSchema = SkillMutationUiResponseSchema;
export const DeleteSkillUiResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), skillPath: z.string().min(1) }).strict(),
  z.object({ status: z.literal('not_found'), skillPath: z.string().min(1) }).strict(),
  z.object({
    status: z.literal('not_allowed'),
    skillPath: z.string().min(1),
    reason: z.enum(['system_skill', 'skill_root']),
  }).strict(),
  z.object({ status: z.literal('failed'), failure: z.object({ code: z.string(), message: z.string() }).strict() }).strict(),
]);
export const RefreshSkillsUiResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok') }).strict(),
  z.object({ status: z.literal('failed'), failure: z.object({ code: z.string(), message: z.string() }).strict() }).strict(),
]);

export function createSkillHost(input: {
  skills: Skills;
}): SkillHost {
  return {
    async listSkills(request) {
      const result = await input.skills.list({ workspaceId: request.workspaceId });
      return result.status === 'failed'
        ? toSkillFailure(result.failure)
        : { status: 'ok', skills: result.skills.map(toSkillListUiItem) };
    },
    async getSkillDetail(request) {
      const result = await input.skills.get({ skillPath: request.skillPath, workspaceId: request.workspaceId });
      if (result.status === 'failed' && result.failure.code === 'skill_not_found') {
        return { status: 'not_found', skillPath: request.skillPath };
      }
      if (result.status === 'failed') return toSkillFailure(result.failure);
      return { status: 'ok', skill: toSkillDetailUiDto(result.skill) };
    },
    async enableSkill(request) {
      const result = await input.skills.enable({ skillPath: request.skillPath, workspaceId: request.workspaceId });
      if (result.status === 'failed' && result.failure.code === 'skill_not_found') {
        return { status: 'not_found', skillPath: request.skillPath };
      }
      if (result.status === 'failed') return toSkillFailure(result.failure);
      return { status: 'ok', skillPath: result.availability.skillPath };
    },
    async disableSkill(request) {
      const result = await input.skills.disable({ skillPath: request.skillPath, workspaceId: request.workspaceId });
      if (result.status === 'failed' && result.failure.code === 'skill_not_found') {
        return { status: 'not_found', skillPath: request.skillPath };
      }
      if (result.status === 'failed') return toSkillFailure(result.failure);
      return { status: 'ok', skillPath: result.availability.skillPath };
    },
    async deleteSkill(request) {
      const result = await input.skills.delete({ skillPath: request.skillPath, workspaceId: request.workspaceId });
      if (result.status === 'failed' && result.failure.code === 'skill_not_found') {
        return { status: 'not_found', skillPath: request.skillPath };
      }
      if (result.status === 'failed' && result.failure.code === 'delete_not_allowed') {
        return { status: 'not_allowed', skillPath: request.skillPath, reason: result.failure.reason };
      }
      if (result.status === 'failed') return toSkillFailure(result.failure);
      return { status: 'ok', skillPath: result.skillPath };
    },
    async refreshSkills(request) {
      const result = await input.skills.refresh({ workspaceId: request.workspaceId });
      return result.status === 'failed'
        ? toSkillFailure(result.failure)
        : { status: 'ok' };
    },
  };
}

function toSkillListUiItem(skill: Skill): SkillListUiItem {
  const overview = buildSkillPackageOverview(skill);
  return {
    name: skill.name,
    description: skill.description,
    skillPath: skill.skillPath,
    sourceLabel: skill.source.owner === 'system' ? 'System' : 'User',
    available: skill.available,
    hasResources: overview.hasReferences || overview.hasAssets,
    hasScripts: overview.hasScripts,
    diagnostics: skill.diagnostics.map(({ level, message }) => ({ level, message })),
  };
}

function toSkillDetailUiDto(skill: Skill): SkillDetailUiDto {
  const overview = buildSkillPackageOverview(skill);
  return {
    ...toSkillListUiItem(skill),
    content: skill.content,
    resourcePaths: [
      ...(overview.hasReferences ? ['references/'] : []),
      ...(overview.hasAssets ? ['assets/'] : []),
    ],
    scriptNames: overview.hasScripts ? ['scripts/'] : [],
  };
}

function toSkillFailure(failure: SkillsFailure): { status: 'failed'; failure: { code: string; message: string } } {
  return { status: 'failed', failure: { code: failure.code, message: skillsFailureMessage(failure) } };
}

export type ListSkillsUiRequest = { workspaceId?: string };
export type GetSkillDetailUiRequest = { skillPath: string; workspaceId?: string };
export type EnableSkillUiRequest = { skillPath: string; workspaceId?: string };
export type DisableSkillUiRequest = { skillPath: string; workspaceId?: string };
export type DeleteSkillUiRequest = { skillPath: string; workspaceId?: string };
export type RefreshSkillsUiRequest = { workspaceId?: string };
export type SkillDiagnosticUiItem = { level: 'info' | 'warning' | 'error'; message: string };
export type SkillListUiItem = {
  name: string;
  description: string;
  skillPath: string;
  sourceLabel: 'System' | 'User';
  available: boolean;
  hasResources: boolean;
  hasScripts: boolean;
  diagnostics: SkillDiagnosticUiItem[];
};
export type SkillDetailUiDto = SkillListUiItem & { content?: string; resourcePaths: string[]; scriptNames: string[] };
export type ListSkillsUiResponse = { status: 'ok'; skills: SkillListUiItem[] } | { status: 'failed'; failure: { code: string; message: string } };
export type GetSkillDetailUiResponse = { status: 'ok'; skill: SkillDetailUiDto } | { status: 'not_found'; skillPath: string } | { status: 'failed'; failure: { code: string; message: string } };
export type EnableSkillUiResponse = { status: 'ok'; skillPath: string } | { status: 'not_found'; skillPath: string } | { status: 'failed'; failure: { code: string; message: string } };
export type DisableSkillUiResponse = EnableSkillUiResponse;
export type DeleteSkillUiResponse =
  | { status: 'ok'; skillPath: string }
  | { status: 'not_found'; skillPath: string }
  | { status: 'not_allowed'; skillPath: string; reason: 'system_skill' | 'skill_root' }
  | { status: 'failed'; failure: { code: string; message: string } };
export type RefreshSkillsUiResponse = { status: 'ok' } | { status: 'failed'; failure: { code: string; message: string } };
