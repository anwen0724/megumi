/* Defines versioned task cases without coupling them to a model or runtime profile. */
import { z } from 'zod';

export const EvaluationFixtureReferenceSchema = z.object({
  fixtureId: z.string().min(1),
}).strict();

export const EvaluationUserRequestSchema = z.object({
  text: z.string().min(1),
  attachments: z.array(z.object({
    path: z.string().min(1),
    type: z.literal('image').default('image'),
    mimeType: z.string().min(1).optional(),
  }).strict()).optional(),
}).strict();

export const EvaluationEnvironmentRequirementSchema = z.object({
  tools: z.array(z.string().min(1)).optional(),
  networkAccess: z.enum(['disabled', 'controlled', 'live']).optional(),
  minimumIsolation: z.enum(['workspace_only', 'os_sandbox', 'container', 'vm']).optional(),
}).strict();

export const EvaluationApprovalDecisionSchema = z.object({
  matcher: z.object({
    toolName: z.string().min(1),
    toolIdentity: z.object({
      sourceId: z.string().min(1),
      namespace: z.string().min(1),
      sourceToolName: z.string().min(1),
    }).strict().optional(),
    action: z.string().min(1).optional(),
    resource: z.string().min(1).optional(),
    occurrence: z.number().int().positive().default(1),
  }).strict(),
  decision: z.enum(['allow_once', 'allow_session', 'deny']),
}).strict();

export const EvaluationGraderTypeSchema = z.enum([
  'file_exists',
  'file_absent',
  'file_content',
  'file_unchanged',
  'final_reply',
  'tool_activity',
  'behavior',
  'completion_claim',
  'human_rubric',
]);

export const EvaluationGraderConfigSchema = z.object({
  graderId: z.string().min(1),
  type: EvaluationGraderTypeSchema,
  required: z.boolean().default(false),
  config: z.record(z.unknown()).optional(),
}).strict();

export const EvaluationCaseSchema = z.object({
  schemaVersion: z.literal(1),
  caseId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string().min(1)),
  fixture: EvaluationFixtureReferenceSchema.optional(),
  request: EvaluationUserRequestSchema,
  requirements: EvaluationEnvironmentRequirementSchema.optional(),
  approvalScript: z.array(EvaluationApprovalDecisionSchema).optional(),
  graders: z.array(EvaluationGraderConfigSchema).min(1),
}).strict();

export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;
export type EvaluationApprovalDecision = z.infer<typeof EvaluationApprovalDecisionSchema>;
export type EvaluationGraderConfig = z.infer<typeof EvaluationGraderConfigSchema>;
