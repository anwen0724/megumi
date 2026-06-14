// Defines the minimal external_test source registration used to prove non-built-in registry flow before source execution is wired.
import type { ToolDefinition, ToolRegistration } from '@megumi/shared/tool';

export const EXTERNAL_TEST_TOOL_SOURCE_ID = 'external_test' as const;
export const EXTERNAL_TEST_TOOL_NAMESPACE = 'demo' as const;

const externalTestEchoDefinition: ToolDefinition = {
  name: 'echo',
  title: 'Echo',
  description: 'Echo a message through the external test source.',
  modelFacingDescription: 'Echo a message through the demo external test tool.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Message to echo.' },
    },
    required: ['message'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string' },
    },
    required: ['message'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  capabilities: ['external_app'],
  riskLevel: 'low',
  sideEffect: 'read_external',
  availability: { status: 'available' },
  executionMode: 'sequential',
  permissionMetadata: { ruleToolName: 'demo_echo' },
};

function cloneToolDefinition(definition: ToolDefinition): ToolDefinition {
  return JSON.parse(JSON.stringify(definition)) as ToolDefinition;
}

export function createExternalTestToolRegistrations(): ToolRegistration[] {
  return [{
    registrationId: 'tool-registration-external_test-echo',
    sourceId: EXTERNAL_TEST_TOOL_SOURCE_ID,
    namespace: EXTERNAL_TEST_TOOL_NAMESPACE,
    sourceToolName: 'echo',
    definition: cloneToolDefinition(externalTestEchoDefinition),
    enabled: true,
    availability: { status: 'available' },
    executorBinding: { kind: 'external_test', bindingKey: 'echo' },
    registrationMetadata: { registrationKind: 'external_test' },
  }];
}
