/* Guards the Context Package structure, stable exports, and Owner boundaries. */
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Context Package source guards', () => {
  it('provides the confirmed Context Package files', () => {
    expect(listFiles('packages/context/src')).toEqual([
      'compaction/compaction-planner.ts',
      'compaction/compaction-summary.ts',
      'compaction/context-compactor.ts',
      'context-builder.ts',
      'context-messages.ts',
      'context-policy.ts',
      'context-usage.ts',
      'context.ts',
      'image-content.ts',
      'index.ts',
      'system-prompt.ts',
      'xml-escape.ts',
    ]);
    expect(exists('packages/context/package.json')).toBe(true);
    expect(exists('packages/context/tsconfig.json')).toBe(true);
  });

  it('exports capability contracts without exposing implementation helpers or Service synonyms', () => {
    const publicIndex = read('packages/context/src/index.ts');

    for (const required of [
      'createContext',
      'ContextBuilder',
      'ContextCompactor',
      'deriveContextUsage',
      'DEFAULT_COMPACTION_POLICY',
    ]) {
      expect(publicIndex).toContain(required);
    }
    expect(publicIndex).not.toMatch(/ContextService|context-service|compaction-planner|compaction-summary|image-content|context-messages/u);
  });

  it('does not recreate repository, ports, DTO, or Service layers', () => {
    for (const forbidden of [
      'packages/context/src/repository',
      'packages/context/src/ports',
      'packages/context/src/domain/dto',
      'packages/context/src/service',
      'packages/context/src/services',
    ]) {
      expect(exists(forbidden), forbidden).toBe(false);
    }
  });

  it('keeps Context independent from Product, Settings, providers, Desktop, and Database', () => {
    const source = readTree('packages/context/src');

    expect(source).not.toMatch(/@megumi\/(?:product|settings|database)(?:\/|['"])/u);
    expect(source).not.toMatch(/from ['"][^'"]*provider/iu);
    expect(source).not.toMatch(/from ['"](?:node:fs|node:path|node:child_process|node:os|electron)|apps[\\/]desktop/u);
    expect(source).not.toMatch(/better-sqlite3|sqlite|Repository/u);
  });

  it('keeps Usage derived from Session History and the Compaction Policy explicit', () => {
    const contextSource = readTree('packages/context/src');

    expect(contextSource).toContain('keepRecentTokens');
    expect(contextSource).toContain('minimumRecentMessages');
    expect(contextSource).toContain('reserveTokens');
    expect(contextSource).not.toMatch(/ContextUsageMonitor|ContextUsageRecorder|ContextUsageSnapshot|subscribeContextUsage|unsubscribeContextUsage/u);
    expect(contextSource).not.toContain('recordCompletedModelCall');
    const hostSource = read('packages/product/src/host/chat-host.ts');
    expect(hostSource).not.toMatch(/refreshAndGetSessionUsage|contextUsageWindowProvider|request\.refresh/u);
  });

  it('keeps the main chain RunContext -> ModelCallContext -> Prompt -> AI', () => {
    const contextSource = readTree('packages/context/src');
    expect(contextSource).toContain('RunContext');
    expect(contextSource).toContain('ModelCallContext');
    expect(contextSource).toContain('Prompt');
    expect(contextSource).not.toContain('BuiltContext');
    expect(contextSource).not.toContain('ContextContent');
    expect(contextSource).not.toContain('PromptItem');
  });

  it('keeps ModelCallContext to only execution identities and Tool Definitions', () => {
    const contextSource = read('packages/context/src/context.ts');
    expect(contextSource).toMatch(/ModelCallContext/);
    expect(contextSource).toContain('modelCallId');
    expect(contextSource).toContain('readonly tools: readonly ToolDefinition[]');
    // Dynamic prompt sources are no longer carried into ModelCallContext.
    expect(contextSource).not.toMatch(/executionEnvironment[?]?:/u);
    expect(contextSource).not.toContain('effectiveInstructions');
    expect(contextSource).not.toContain('SkillView');
    expect(contextSource).not.toContain('ToolView');
  });

  it('keeps the Prompt as the explicit three-part Context output', () => {
    const contextSource = read('packages/context/src/context.ts');
    expect(contextSource).toContain('readonly systemPrompt: string');
    expect(contextSource).toContain('readonly messages: readonly Message[]');
    expect(contextSource).toContain('readonly tools: readonly ToolDefinition[]');
    // The Prompt is not the AI Context alias.
    expect(contextSource).not.toMatch(/export type Prompt = AiContext/u);
  });

  it('keeps Workspace, Instructions and Skills source resolution inside Context', () => {
    const contextSource = readTree('packages/context/src');
    expect(contextSource).toContain('ContextWorkspaceSource');
    expect(contextSource).toContain('resolveSources');
    expect(contextSource).toContain("readWorkspace({");
    expect(contextSource).toContain('getEffectiveInstructions(');
    expect(contextSource).toContain('skills.createView(');
    // Engine and Product no longer read these sources for Context.
    expect(read('packages/engine/src/run-loop.ts')).not.toContain('scopeResolver');
    expect(read('packages/engine/src/run-loop.ts')).not.toMatch(/getEffectiveInstructions|createView/u);
    expect(read('packages/product/src/product.ts')).not.toContain('scopeResolver');
  });
});

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readTree(relativePath: string): string {
  return listAbsoluteFiles(relativePath)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
}

function listFiles(relativePath: string): string[] {
  const absolutePath = path.join(root, relativePath);
  return listAbsoluteFiles(relativePath)
    .map((file) => path.relative(absolutePath, file).replaceAll('\\', '/'))
    .sort();
}

function listAbsoluteFiles(relativePath: string): string[] {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  return fs.readdirSync(absolutePath, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}
