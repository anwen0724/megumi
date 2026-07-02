// Applies run permission policy to tool executions created by model tool calls.
import { evaluatePermissionPolicy } from '../../../permissions/tool-policy';
import type {
  PermissionDecision,
  ToolDefinition,
  ToolExecutionRecord,
} from '@megumi/shared/tool';
import type { ToolExecutionDecisionInput } from '../../../permissions/tool-execution-decision';
import type { ResolvedToolCallRunnerOptions } from '../tool-call-runner';
import { createApprovalRequest } from './approval-events';
import { createRejectionObservation } from './rejection-observation';

export async function applyDecisionsToCreated(
  options: ResolvedToolCallRunnerOptions,
  input: { runId: string; assistantMessageId: string },
): Promise<void> {
  const records = options.repository.listToolExecutionsByAssistantMessage(input);
  for (const record of records) {
    if (record.status !== 'created' || record.decision) {
      continue;
    }
    applyDecision(options, record);
  }
}

export function inferredDefinitionFields(
  toolName: string,
): Pick<ToolDefinition, 'capabilities' | 'riskLevel' | 'sideEffect'> {
  if (toolName === 'run_command') {
    return {
      capabilities: ['command_run'],
      riskLevel: 'medium',
      sideEffect: 'execute_command',
    };
  }
  if (toolName === 'edit_file' || toolName === 'write_file') {
    return {
      capabilities: ['project_write'],
      riskLevel: 'medium',
      sideEffect: 'project_file_operation',
    };
  }
  return {
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
  };
}

function applyDecision(
  options: ResolvedToolCallRunnerOptions,
  record: ToolExecutionRecord,
): ToolExecutionRecord {
  const permissionDecision = options.repository.recordPermissionDecision(
    permissionDecisionForRecord(options, record),
  );
  const decision = options.decisionEvaluator.evaluate({
    toolName: record.toolName,
    parsedArguments: record.input,
    toolFacts: toolFactsFromRecord(record),
    permissionPosture: options.permissionMode,
    permissionDecision,
    runtimeCapabilityPolicy: options.runtimeCapabilityPolicy,
  });

  if (decision.outcome === 'reject') {
    const observation = createRejectionObservation({
      record,
      decision,
      ids: options.ids,
      now: options.now,
    });
    return options.repository.recordToolExecution({
      ...record,
      decision,
      policyDecision: permissionDecision,
      executionMode: decision.executionMode,
      status: 'rejected',
      completedAt: observation.createdAt,
      observation,
      resultPreview: observation.content.slice(0, 500),
    });
  }

  if (decision.outcome === 'requireApproval') {
    const approvalRequest = options.repository.createApprovalRequest(createApprovalRequest(options, record, decision));
    return options.repository.recordToolExecution({
      ...record,
      decision,
      policyDecision: permissionDecision,
      executionMode: decision.executionMode,
      approvalRequestId: approvalRequest.approvalRequestId,
      status: 'awaitingApproval',
    });
  }

  return options.repository.recordToolExecution({
    ...record,
    decision,
    policyDecision: permissionDecision,
    executionMode: decision.executionMode,
    status: 'queued',
  });
}

function permissionDecisionForRecord(
  options: ResolvedToolCallRunnerOptions,
  record: ToolExecutionRecord,
): PermissionDecision {
  const definition = definitionForRecord(record);
  return {
    ...evaluatePermissionPolicy({
      definition,
      toolExecution: record,
      permissionMode: options.permissionMode,
      projectRoot: options.projectRoot,
      settings: options.settings,
      evaluatedAt: options.now(),
    }),
    permissionDecisionId: options.ids.permissionDecisionId(),
  };
}

function definitionForRecord(
  record: ToolExecutionRecord,
): ToolDefinition {
  const inferred = inferredDefinitionFields(record.toolName);
  return {
    name: record.toolName,
    description: record.toolName,
    inputSchema: { type: 'object', properties: {}, additionalProperties: true },
    capabilities: [...(record.capabilities ?? inferred.capabilities)],
    riskLevel: record.riskLevel ?? inferred.riskLevel,
    sideEffect: record.sideEffect ?? inferred.sideEffect,
    availability: { status: 'available' },
    executionMode: record.executionMode,
  };
}

function toolFactsFromRecord(record: ToolExecutionRecord): ToolExecutionDecisionInput['toolFacts'] {
  if (!record.sourceId || !record.namespace || !record.sourceToolName || !record.modelVisibleName) {
    return undefined;
  }
  return {
    registeredToolName: record.modelVisibleName,
    sourceId: record.sourceId,
    namespace: record.namespace,
    sourceToolName: record.sourceToolName,
    capabilities: record.capabilities,
    riskLevel: record.riskLevel,
    sideEffect: record.sideEffect,
    executionMode: record.executionMode,
  };
}
