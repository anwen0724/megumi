/*
 * Protects the AI package's stable Megumi contracts and its existing
 * independently publishable entry points and generated resources.
 */

// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AssistantMessageEventStream,
  AssistantContentBlockSchema,
  ContentBlockListSchema,
  JsonObjectSchema,
  ModelCapabilitiesSchema,
  capabilitiesFromModel,
  type Api,
  type Model,
} from '@megumi/ai';

const packageRoot = path.resolve(process.cwd(), 'packages', 'ai');

describe('AI package contract', () => {
  it.each(['done', 'error', 'end'] as const)(
    'settles AssistantMessageEventStream after %s termination',
    async (termination) => {
      const stream = new AssistantMessageEventStream();
      const message = {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        api: 'test-api',
        provider: 'provider:1',
        model: 'model:1',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: termination === 'error' ? 'error' : 'stop',
        timestamp: 1,
      } as const;

      const settlement = stream.waitForSettlement();
      if (termination === 'done') {
        stream.push({ type: 'done', reason: 'stop', message });
      } else if (termination === 'error') {
        stream.fail({ reason: 'error', error: message });
      } else {
        stream.end();
      }

      await expect(settlement).resolves.toBeUndefined();
    },
  );

  it('keeps the independent publish and build entry points', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
    ) as {
      exports: Record<string, unknown>;
      bin: Record<string, string>;
      files: string[];
      sideEffects: string[];
    };

    expect(manifest.exports).toMatchObject({
      '.': expect.any(Object),
      './providers/*': expect.any(Object),
      './api/*': expect.any(Object),
      './bun-oauth': expect.any(Object),
    });
    expect(manifest.bin).toEqual({ 'megumi-ai': 'dist/cli.js' });
    expect(manifest.files).toEqual(expect.arrayContaining(['dist', 'README.md']));
    expect(manifest.sideEffects).toEqual(expect.arrayContaining([
      './dist/images.js',
      './dist/providers/images/register-builtins.js',
    ]));
    expect(fs.existsSync(path.join(packageRoot, 'tsconfig.json'))).toBe(true);
    expect(fs.existsSync(path.join(packageRoot, 'src', 'models.generated.ts'))).toBe(true);
    expect(fs.existsSync(path.join(packageRoot, 'src', 'image-models.generated.ts'))).toBe(true);
    expect(fs.existsSync(path.join(packageRoot, 'src', 'providers', 'data', '.manifest.json'))).toBe(true);
  });

  it('validates recursive JSON and provider-neutral message content', () => {
    expect(JsonObjectSchema.parse({ nested: ['text', 1, true, null] })).toEqual({
      nested: ['text', 1, true, null],
    });
    expect(ContentBlockListSchema.parse([
      { type: 'text', text: 'hello' },
      {
        type: 'image',
        source: { type: 'host_reference', referenceId: 'attachment:1' },
      },
      { type: 'file', path: 'notes.md', mediaType: 'text/markdown' },
    ])).toHaveLength(3);
    expect(AssistantContentBlockSchema.parse({
      type: 'toolCall',
      id: 'call:1',
      name: 'read_file',
      argumentsText: '{"path":"notes.md"}',
    })).toMatchObject({ type: 'toolCall', name: 'read_file' });
  });

  it('derives product-facing model capabilities without provider-specific input', () => {
    const model = {
      reasoning: true,
      input: ['text', 'image'],
    } as unknown as Model<Api>;

    expect(capabilitiesFromModel(model)).toEqual({
      streaming: true,
      toolCalls: true,
      thinking: true,
      imageInput: true,
    });
    expect(ModelCapabilitiesSchema.safeParse({ imageInput: 'unknown' }).success).toBe(true);
    expect(ModelCapabilitiesSchema.safeParse({ imageInput: 'unsupported' }).success).toBe(false);
  });
});
