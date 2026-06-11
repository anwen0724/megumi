// @vitest-environment node
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  RuntimeContextSchema,
  RuntimeDebugIdSchema,
  RuntimeOperationNameSchema,
  RuntimeResultMetaSchema,
  RuntimeTraceIdSchema,
  createRuntimeContext,
  createRuntimeDebugId,
  createRuntimeTraceId,
} from '@megumi/shared/runtime';
import {
  RuntimeRequestSchema,
  createRuntimeRequest,
  createRuntimeRequestSchema,
} from '@megumi/shared/runtime';
import {
  RuntimeFailureSchema,
  RuntimeSuccessSchema,
  createRuntimeResultSchema,
} from '@megumi/shared/runtime';

describe('runtime common contracts', () => {
  it('creates runtime context with required trace metadata and optional debug id', () => {
    const context = createRuntimeContext({
      requestId: 'ipc-provider-list-1',
      traceId: 'trace-test-1',
      operationName: 'provider.list',
      source: 'renderer',
      createdAt: '2026-05-14T00:00:00.000Z',
    });

    expect(context).toEqual({
      requestId: 'ipc-provider-list-1',
      traceId: 'trace-test-1',
      operationName: 'provider.list',
      source: 'renderer',
      createdAt: '2026-05-14T00:00:00.000Z',
    });
    expect('debugId' in context).toBe(false);
    expect(RuntimeContextSchema.parse(context)).toEqual(context);
  });

  it('validates operation names as lowercase dotted names', () => {
    expect(RuntimeOperationNameSchema.parse('provider.list')).toBe('provider.list');
    expect(RuntimeOperationNameSchema.parse('provider.set-api-key')).toBe('provider.set-api-key');
    expect(RuntimeOperationNameSchema.parse('session.message.send')).toBe('session.message.send');

    expect(() => RuntimeOperationNameSchema.parse('provider')).toThrow();
    expect(() => RuntimeOperationNameSchema.parse('Provider.List')).toThrow();
    expect(() => RuntimeOperationNameSchema.parse('provider list')).toThrow();
  });

  it('generates trace and debug ids without forcing debug ids onto every context', () => {
    const traceId = createRuntimeTraceId();
    const debugId = createRuntimeDebugId();

    expect(RuntimeTraceIdSchema.parse(traceId)).toBe(traceId);
    expect(RuntimeDebugIdSchema.parse(debugId)).toBe(debugId);
    expect(traceId).toMatch(/^trace-[A-Za-z0-9:_-]+$/);
    expect(debugId).toMatch(/^debug-[A-Za-z0-9:_-]+$/);
  });

  it('creates and validates generic runtime requests', () => {
    const context = createRuntimeContext({
      requestId: 'ipc-chat-start-1',
      traceId: 'trace-chat-1',
      operationName: 'session.message.send',
      source: 'main',
      createdAt: '2026-05-14T00:00:00.000Z',
    });
    const request = createRuntimeRequest(context, {
      message: 'Hello Megumi',
    });
    const schema = createRuntimeRequestSchema(
      z.object({
        message: z.string().min(1),
      }).strict(),
    );

    expect(request).toEqual({
      context,
      payload: {
        message: 'Hello Megumi',
      },
    });
    expect(RuntimeRequestSchema.parse(request)).toEqual(request);
    expect(schema.parse(request)).toEqual(request);
  });

  it('validates generic runtime result metadata and success/failure envelopes', () => {
    const meta = {
      requestId: 'ipc-provider-list-1',
      traceId: 'trace-provider-1',
      operationName: 'provider.list',
      handledAt: '2026-05-14T00:00:01.000Z',
      durationMs: 12,
    };
    const resultSchema = createRuntimeResultSchema(
      z.object({
        providerId: z.literal('deepseek'),
      }).strict(),
    );

    const success = {
      ok: true,
      data: {
        providerId: 'deepseek',
      },
      meta,
    };
    const failure = {
      ok: false,
      error: {
        code: 'runtime_unknown',
        message: 'Unexpected runtime error.',
        severity: 'error',
        retryable: true,
        source: 'main',
        debugId: 'debug-provider-1',
      },
      meta: {
        ...meta,
        debugId: 'debug-provider-1',
      },
    };

    expect(RuntimeResultMetaSchema.parse(meta)).toEqual(meta);
    expect(RuntimeSuccessSchema(z.object({ providerId: z.literal('deepseek') }).strict()).parse(success)).toEqual(success);
    expect(RuntimeFailureSchema.parse(failure)).toEqual(failure);
    expect(resultSchema.parse(success)).toEqual(success);
    expect(resultSchema.parse(failure)).toEqual(failure);
  });
});

