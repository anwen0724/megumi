import { z } from 'zod';

export const WORKFLOW_COMMAND_KINDS = ['workflow'] as const;
export const WORKFLOW_COMMAND_SOURCES = ['builtin_command'] as const;
export const WORKFLOW_INTENTS = ['code_review'] as const;

export const WorkflowCommandSourceSchema = z.enum(WORKFLOW_COMMAND_SOURCES);
export const WorkflowIntentSchema = z.enum(WORKFLOW_INTENTS);

export const CodeReviewWorkflowCommandMetadataSchema = z
  .object({
    intent: z.literal('code_review'),
    source: z.literal('builtin_command'),
    commandName: z.literal('review'),
    argsText: z.string(),
  })
  .strict();

export const WorkflowCommandMetadataSchema = z.discriminatedUnion('intent', [
  CodeReviewWorkflowCommandMetadataSchema,
]);

export type WorkflowCommandSource = z.infer<typeof WorkflowCommandSourceSchema>;
export type WorkflowIntent = z.infer<typeof WorkflowIntentSchema>;
export type CodeReviewWorkflowCommandMetadata = z.infer<typeof CodeReviewWorkflowCommandMetadataSchema>;
export type WorkflowCommandMetadata = z.infer<typeof WorkflowCommandMetadataSchema>;

export function createCodeReviewWorkflowCommandMetadata(argsText: string): CodeReviewWorkflowCommandMetadata {
  return {
    intent: 'code_review',
    source: 'builtin_command',
    commandName: 'review',
    argsText: argsText.trim(),
  };
}
