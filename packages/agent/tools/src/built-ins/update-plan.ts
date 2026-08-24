/* Defines and executes the internal Tool that publishes complete Run Plan snapshots. */

import type { RawToolResult, ToolDefinition } from '../tool';
import { ToolExecutionFailure } from '../tool-result';
import { createBuiltInToolHandler } from './tool-handler';

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed';

export interface PlanStep {
  readonly step: string;
  readonly status: PlanStepStatus;
}

export interface UpdatePlanInput {
  readonly explanation?: string;
  readonly plan: readonly PlanStep[];
}

export const updatePlanToolDefinition: ToolDefinition = {
  name: 'update_plan',
  description: 'Update the current task plan with a complete ordered snapshot of its steps and statuses. Each update replaces the entire plan.',
  promptSnippet: 'Update the current task plan snapshot.',
  parameters: {
    type: 'object',
    properties: {
      explanation: { type: 'string', description: 'Optional reason for this plan update.' },
      plan: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            step: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['step', 'status'],
          additionalProperties: false,
        },
      },
    },
    required: ['plan'],
    additionalProperties: false,
  },
};

export const updatePlanToolHandler = createBuiltInToolHandler({
  toolName: 'update_plan',
  operations: () => [],
  async execute(_context, input, options): Promise<RawToolResult> {
    const plan = parseUpdatePlanInput(input);
    const inProgress = plan.plan.filter((step) => step.status === 'in_progress').length;
    if (inProgress > 1) {
      throw new ToolExecutionFailure(
        'A plan cannot contain more than one in_progress step.',
        'invalid_tool_input',
      );
    }
    options.onNotification?.({
      type: 'plan_updated',
      ...(plan.explanation ? { explanation: plan.explanation } : {}),
      plan: plan.plan,
    });
    return { outputKind: 'text', content: 'Plan updated' };
  },
});

function parseUpdatePlanInput(value: unknown): UpdatePlanInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolExecutionFailure('update_plan input must be an object.', 'invalid_tool_input');
  }
  const input = value as { explanation?: unknown; plan?: unknown };
  if (!Array.isArray(input.plan)) {
    throw new ToolExecutionFailure('update_plan requires plan.', 'invalid_tool_input');
  }
  return {
    ...(typeof input.explanation === 'string' ? { explanation: input.explanation } : {}),
    plan: input.plan.map((item) => item as PlanStep),
  };
}
