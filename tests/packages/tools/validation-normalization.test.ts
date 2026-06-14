import { describe, expect, it } from 'vitest';
import {
  createToolInputValidationError,
  normalizeToolError,
  normalizeToolResult,
  validateToolInput,
} from '@megumi/tools';
import type { ToolDefinition, ToolExecution } from '@megumi/shared/tool';

const definition: ToolDefinition = {
  name: 'read_file',
  description: 'Read a normal project file.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  outputSchema: {
    type: 'object',
    properties: { content: { type: 'string' } },
  },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
};

const call: ToolExecution = {
  toolExecutionId: 'tool-execution-1',
  toolCallId: 'tool-call-1',
  runId: 'run-1',
  stepId: 'step-1',
  actionId: 'action-1',
  toolName: 'read_file',
  input: { path: 'src/index.ts' },
  inputPreview: {
    summary: 'Read src/index.ts',
    targets: [{ kind: 'file', label: 'src/index.ts', sensitivity: 'normal' }],
    redactionState: 'none',
  },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  status: 'running',
  requestedAt: '2026-05-16T00:00:00.000Z',
};

describe('tool validation and normalization', () => {
  it('validates required object properties from JSON Schema', () => {
    expect(validateToolInput(definition, { path: 'src/index.ts' }).ok).toBe(true);
    expect(validateToolInput(definition, {}).ok).toBe(false);
    expect(validateToolInput(definition, { path: 123 }).ok).toBe(false);
  });

  it('normalizes successful tool results', () => {
    expect(normalizeToolResult(call, {
      toolResultId: 'tool-result-1',
      structuredContent: { content: 'hello' },
      createdAt: '2026-05-20T00:00:01.000Z',
      metadata: { lineCount: 1 },
    })).toEqual({
      toolResultId: 'tool-result-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      runId: 'run-1',
      kind: 'success',
      structuredContent: { content: 'hello' },
      redactionState: 'none',
      createdAt: '2026-05-20T00:00:01.000Z',
      metadata: { lineCount: 1 },
    });
  });

  it('normalizes errors without raw stack or obsolete error fields', () => {
    const error = normalizeToolError(new Error('boom'), {
      debugId: 'debug-1',
      fallbackMessage: 'Tool failed.',
    });

    expect(error).toMatchObject({
      code: 'tool_execution_failed',
      message: 'boom',
      severity: 'error',
      retryable: false,
      source: 'tool',
      debugId: 'debug-1',
    });
    expect(error).not.toHaveProperty(['recover', 'able'].join(''));
    expect(error.details).toBeUndefined();
  });

  it('creates invalid input RuntimeError', () => {
    expect(createToolInputValidationError('debug-2', 'Missing required property: path')).toMatchObject({
      code: 'tool_input_invalid',
      retryable: false,
      source: 'tool',
      debugId: 'debug-2',
    });
  });
});

describe('validateToolInput JSON Schema subset', () => {
  it('validates nested objects and required properties', () => {
    const schema = {
      type: 'object',
      required: ['path', 'options'],
      properties: {
        path: { type: 'string' },
        options: {
          type: 'object',
          required: ['limit'],
          properties: {
            limit: { type: 'integer' },
          },
        },
      },
    };

    expect(validateToolInput(definitionWithSchema(schema), {
      path: 'README.md',
      options: { limit: 10 },
    }).ok).toBe(true);
    expect(validateToolInput(definitionWithSchema(schema), {
      path: 'README.md',
      options: { limit: 1.5 },
    })).toEqual({
      ok: false,
      errorMessage: 'Invalid tool input at $.options.limit: expected integer.',
    });
  });

  it('rejects additional properties when additionalProperties is false', () => {
    expect(validateToolInput(definitionWithSchema({
      type: 'object',
      properties: { path: { type: 'string' } },
      additionalProperties: false,
    }), { path: 'README.md', extra: true })).toEqual({
      ok: false,
      errorMessage: 'Invalid tool input at $.extra: additional properties are not allowed.',
    });
  });

  it('validates arrays and item schemas', () => {
    expect(validateToolInput(definitionWithSchema({
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' } },
          },
        },
      },
    }), { items: [{ name: 123 }] })).toEqual({
      ok: false,
      errorMessage: 'Invalid tool input at $.items[0].name: expected string.',
    });
  });

  it('validates enum values', () => {
    expect(validateToolInput(definitionWithSchema({
      type: 'object',
      properties: {
        mode: { enum: ['read', 'write'] },
      },
    }), { mode: 'delete' })).toEqual({
      ok: false,
      errorMessage: 'Invalid tool input at $.mode: expected one of ["read","write"].',
    });
  });

  it('validates string minLength and maxLength', () => {
    expect(validateToolInput(definitionWithSchema({
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 2, maxLength: 5 },
      },
    }), { path: 'a' })).toEqual({
      ok: false,
      errorMessage: 'Invalid tool input at $.path: expected string with minLength 2.',
    });
    expect(validateToolInput(definitionWithSchema({
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 2, maxLength: 5 },
      },
    }), { path: 'abcdef' })).toEqual({
      ok: false,
      errorMessage: 'Invalid tool input at $.path: expected string with maxLength 5.',
    });
  });

  it('validates number minimum and maximum', () => {
    expect(validateToolInput(definitionWithSchema({
      type: 'object',
      properties: {
        count: { type: 'number', minimum: 1, maximum: 3 },
      },
    }), { count: 0 })).toEqual({
      ok: false,
      errorMessage: 'Invalid tool input at $.count: expected number >= 1.',
    });
    expect(validateToolInput(definitionWithSchema({
      type: 'object',
      properties: {
        count: { type: 'number', minimum: 1, maximum: 3 },
      },
    }), { count: 4 })).toEqual({
      ok: false,
      errorMessage: 'Invalid tool input at $.count: expected number <= 3.',
    });
  });

  it('validates integer separately from number', () => {
    expect(validateToolInput(definitionWithSchema({
      type: 'object',
      properties: {
        limit: { type: 'integer' },
      },
    }), { limit: 1.25 })).toEqual({
      ok: false,
      errorMessage: 'Invalid tool input at $.limit: expected integer.',
    });
  });

  it('reports stable json paths in validation errors', () => {
    expect(validateToolInput(definitionWithSchema({
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
    }), { path: 123 })).toEqual({
      ok: false,
      errorMessage: 'Invalid tool input at $.path: expected string.',
    });
  });
});

function definitionWithSchema(inputSchema: ToolDefinition['inputSchema']): ToolDefinition {
  return {
    name: 'demo_tool',
    description: 'Demo tool.',
    inputSchema,
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
    availability: { status: 'available' },
  };
}

