/* Defines stable, host-neutral Skill management operations exposed by Product. */
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
