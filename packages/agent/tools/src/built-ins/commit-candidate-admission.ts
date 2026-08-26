/* Defines the typed Tool that commits one bounded Candidate admission batch. */
import { Type } from '@megumi/ai';
import type { JsonSchemaObject, RawToolResult } from '../tool';
import type { ToolHandler } from '../tool-handler';
import type { BuiltInToolContext } from './workspace-file-access';

export interface CommitCandidateAdmissionOperation {
  commitCandidateAdmission(request: {
    readonly executionId: string;
    readonly input: unknown;
    readonly signal: AbortSignal;
  }): Promise<RawToolResult>;
}

const commonDecisionFields = {
  candidateId: Type.String(),
  reason: Type.String(),
};

export const commitCandidateAdmissionToolDefinition = {
  name: 'commit_candidate_admission',
  description: 'Commit a complete bounded batch of Candidate admission decisions.',
  promptSnippet: 'Commit typed admit, needs-detail, or reject decisions for the current Candidate batch.',
  parameters: Type.Object({
    decisions: Type.Array(Type.Union([
      Type.Object({
        ...commonDecisionFields,
        decision: Type.Literal('admit'),
        relevance: Type.Union([Type.Literal('direct'), Type.Literal('adjacent'), Type.Literal('exploration')]),
        matchedInterestIds: Type.Array(Type.String()),
        contentValue: Type.Literal('substantive'),
        novelty: Type.Literal('novel'),
        temporalValidity: Type.Literal('valid'),
        negativeConstraint: Type.Literal('clear'),
      }),
      Type.Object({
        ...commonDecisionFields,
        decision: Type.Literal('needs_detail'),
      }),
      Type.Object({
        ...commonDecisionFields,
        decision: Type.Literal('reject'),
        relevance: Type.Union([
          Type.Literal('direct'), Type.Literal('adjacent'),
          Type.Literal('exploration'), Type.Literal('none'),
        ]),
        matchedInterestIds: Type.Array(Type.String()),
        contentValue: Type.Union([Type.Literal('substantive'), Type.Literal('low_value')]),
        novelty: Type.Union([Type.Literal('novel'), Type.Literal('semantic_duplicate')]),
        temporalValidity: Type.Union([Type.Literal('valid'), Type.Literal('stale'), Type.Literal('uncertain')]),
        negativeConstraint: Type.Union([Type.Literal('clear'), Type.Literal('conflict')]),
        duplicateOfCandidateId: Type.Optional(Type.String()),
        duplicateOfRecommendationId: Type.Optional(Type.String()),
        reasonCode: Type.Union([
          Type.Literal('insufficient_content'), Type.Literal('unrelated'),
          Type.Literal('low_value'), Type.Literal('semantic_duplicate'),
          Type.Literal('stale'), Type.Literal('negative_constraint'),
        ]),
      }),
    ]), { minItems: 1, maxItems: 50 }),
  }) as unknown as JsonSchemaObject,
};

export function createCommitCandidateAdmissionToolHandler(
  operation: CommitCandidateAdmissionOperation,
): ToolHandler<BuiltInToolContext> {
  return {
    toolName: 'commit_candidate_admission',
    operations: () => [],
    execute: (_context, invocation, options = {}) => operation.commitCandidateAdmission({
      executionId: invocation.executionId,
      input: invocation.input,
      signal: options.signal ?? NEVER_ABORTED_SIGNAL,
    }),
  };
}

const NEVER_ABORTED_SIGNAL = new AbortController().signal;
