/* Maps Desktop-facing Skill management requests to Root-bound SkillService instances. */
import type { Skill, SkillService } from '@megumi/skills';
import { z } from 'zod';

export interface SkillHost {
  listSkills(request: ListSkillsUiRequest): Promise<ListSkillsUiResponse>;
  getSkillDetail(request: GetSkillDetailUiRequest): Promise<GetSkillDetailUiResponse>;
  enableSkill(request: EnableSkillUiRequest): Promise<EnableSkillUiResponse>;
  disableSkill(request: DisableSkillUiRequest): Promise<DisableSkillUiResponse>;
}

export const SkillListPayloadSchema = z.object({ workspaceId: z.string().min(1).optional() }).strict();
export const SkillGetPayloadSchema = z.object({
  skillPath: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
}).strict();
export const SkillEnablePayloadSchema = SkillGetPayloadSchema;
export const SkillDisablePayloadSchema = SkillGetPayloadSchema;

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

export function createSkillHost(input: {
  resolveSkillService(request: { workspaceId?: string }): SkillService;
}): SkillHost {
  return {
    async listSkills(request) {
      const result = await input.resolveSkillService(request).listSkills({});
      return result.status === 'failed'
        ? toSkillFailure(result.message)
        : { status: 'ok', skills: result.skills.map(toSkillListUiItem) };
    },
    async getSkillDetail(request) {
      const result = await input.resolveSkillService(request).getSkill({ skillPath: request.skillPath });
      if (result.status === 'not_found') return { status: 'not_found', skillPath: result.skillPath };
      if (result.status === 'failed') return toSkillFailure(result.message);
      return { status: 'ok', skill: toSkillDetailUiDto(result.skill) };
    },
    async enableSkill(request) {
      const result = await input.resolveSkillService(request).enableSkill({ skillPath: request.skillPath });
      if (result.status === 'not_found') return { status: 'not_found', skillPath: result.skillPath };
      if (result.status === 'failed') return toSkillFailure(result.message);
      return { status: 'ok', skillPath: result.availability.skillPath };
    },
    async disableSkill(request) {
      const result = await input.resolveSkillService(request).disableSkill({ skillPath: request.skillPath });
      if (result.status === 'not_found') return { status: 'not_found', skillPath: result.skillPath };
      if (result.status === 'failed') return toSkillFailure(result.message);
      return { status: 'ok', skillPath: result.availability.skillPath };
    },
  };
}

function toSkillListUiItem(skill: Skill): SkillListUiItem {
  return {
    name: skill.name,
    description: skill.description,
    skillPath: skill.skillPath,
    sourceLabel: skill.source.owner === 'system' ? 'System' : 'User',
    available: skill.available,
    hasResources: skill.resources.length > 0,
    hasScripts: skill.scripts.length > 0,
    diagnostics: skill.diagnostics.map(({ level, message }) => ({ level, message })),
  };
}

function toSkillDetailUiDto(skill: Skill): SkillDetailUiDto {
  return {
    ...toSkillListUiItem(skill),
    content: skill.content,
    resourcePaths: skill.resources.map((resource) => resource.resourcePath),
    scriptNames: skill.scripts.map((script) => script.name),
  };
}

function toSkillFailure(message: string): { status: 'failed'; failure: { code: string; message: string } } {
  return { status: 'failed', failure: { code: 'skill_failed', message } };
}

export type ListSkillsUiRequest = { workspaceId?: string };
export type GetSkillDetailUiRequest = { skillPath: string; workspaceId?: string };
export type EnableSkillUiRequest = { skillPath: string; workspaceId?: string };
export type DisableSkillUiRequest = { skillPath: string; workspaceId?: string };
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
