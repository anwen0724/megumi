/*
 * Protects the trimmed provider and adapter scope of the AI package: only the
 * Megumi-supported providers, API adapters, package exports and generated
 * model catalog entries may be exposed.
 */

// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { builtinModels, builtinProviders, getBuiltinProviders } from '@megumi/ai/providers/all';

const packageRoot = path.resolve(process.cwd(), 'packages', 'ai');

const EXPECTED_PROVIDERS = [
  'anthropic',
  'deepseek',
  'google',
  'huggingface',
  'minimax',
  'minimax-cn',
  'moonshotai',
  'moonshotai-cn',
  'openai',
  'openai-codex',
  'openrouter',
  'qwen-token-plan',
  'qwen-token-plan-cn',
];

const EXPECTED_API_ADAPTERS = [
  'anthropic-messages',
  'google-generative-ai',
  'openai-completions',
  'openai-responses',
  'openai-codex-responses',
  'openrouter-images',
];

const REMOVED_PROVIDER_MARKERS = [
  'amazon-bedrock',
  'ant-ling',
  'azure-openai-responses',
  'baseten',
  'cerebras',
  'cloudflare',
  'fireworks',
  'github-copilot',
  'google-vertex',
  'groq',
  'kimi-coding',
  'mistral',
  'nvidia',
  'opencode',
  'pi-messages',
  'radius',
  'together',
  'vercel-ai-gateway',
  'xai',
  'xiaomi',
  'zai',
];

describe('AI package trimmed scope', () => {
  it('registers exactly the supported built-in providers', () => {
    expect(getBuiltinProviders().sort()).toEqual([...EXPECTED_PROVIDERS].sort());
    const ids = builtinProviders()
      .map((provider) => provider.id)
      .sort();
    expect(ids).toEqual([...EXPECTED_PROVIDERS].sort());
  });

  it('builds a Models collection with only the supported providers', () => {
    const models = builtinModels();
    const ids = models
      .getProviders()
      .map((provider) => provider.id)
      .sort();
    expect(ids).toEqual([...EXPECTED_PROVIDERS].sort());
    const catalogProviders = new Set(getBuiltinProviders()) as Set<string>;
    for (const model of models.getModels()) {
      expect(catalogProviders.has(model.provider)).toBe(true);
    }
  });

  const REMOVED_API_ADAPTERS = [
    'azure-openai-responses',
    'bedrock-converse-stream',
    'cloudflare',
    'google-vertex',
    'mistral-conversations',
    'pi-messages',
  ];

  it('keeps exactly the supported API adapter modules', () => {
    const apiDir = path.join(packageRoot, 'src', 'api');
    const modules = fs
      .readdirSync(apiDir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.lazy.ts') && !file.endsWith('.d.ts'))
      .map((file) => file.replace(/\.ts$/, ''))
      .sort();

    for (const adapter of EXPECTED_API_ADAPTERS) {
      expect(modules).toContain(adapter);
    }
    for (const adapter of REMOVED_API_ADAPTERS) {
      expect(modules).not.toContain(adapter);
    }
  });

  it('keeps only the supported provider registrations on disk', () => {
    const providersDir = path.join(packageRoot, 'src', 'providers');
    const files = fs.readdirSync(providersDir);
    for (const marker of REMOVED_PROVIDER_MARKERS) {
      expect(files.some((file) => file.includes(marker))).toBe(false);
    }
  });

  it('keeps only the supported generated model catalogs', () => {
    const dataDir = path.join(packageRoot, 'src', 'providers', 'data');
    const catalogs = fs
      .readdirSync(dataDir)
      .filter((file) => file.endsWith('.json') && file !== '.manifest.json')
      .map((file) => file.replace(/\.json$/, ''))
      .sort();
    expect(catalogs).toEqual([...EXPECTED_PROVIDERS].sort());
  });

  it('does not export removed subpaths from package.json', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
    ) as { exports: Record<string, unknown>; sideEffects: string[] };

    expect(manifest.exports).not.toHaveProperty('./compat');
    expect(manifest.exports).not.toHaveProperty('./oauth');
    expect(manifest.exports).not.toHaveProperty('./bedrock-provider');
    expect(manifest.sideEffects).not.toContain('./dist/compat.js');
  });
});
