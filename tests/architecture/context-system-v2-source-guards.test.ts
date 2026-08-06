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
      'compaction/compaction-summary-generator.ts',
      'compaction/context-compactor.ts',
      'context-builder.ts',
      'context-failure-factory.ts',
      'context-policy.ts',
      'context-resolver.ts',
      'context-usage-calculator.ts',
      'context.ts',
      'index.ts',
      'prompt/context-message-builder.ts',
      'prompt/image-content-builder.ts',
      'prompt/prompt-builder.ts',
      'prompt/prompt-markup-formatter.ts',
      'prompt/system-prompt-builder.ts',
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
    // Internal owners never leave the Package boundary: no Resolver, Prompt
    // sub-builders, plans, materialized history or Summary generator.
    for (const internal of [
      'ContextResolver',
      'ResolvedContext',
      'ResolveContextRequest',
      'PromptBuilder',
      'MaterializedHistory',
      'CompactionPlan',
      'CompactionMessageSource',
      'compaction-summary-generator',
      'context-resolver',
      'prompt-builder',
      'context-message-builder',
      'compaction-planner',
    ]) {
      expect(publicIndex).not.toContain(internal);
    }
    expect(publicIndex).not.toMatch(/ContextService|context-service/u);
  });

  it('does not recreate repository, ports, DTO, or Service layers', () => {
    for (const forbidden of [
      'packages/context/src/repository',
      'packages/context/src/ports',
      'packages/context/src/domain/dto',
      'packages/context/src/service',
      'packages/context/src/services',
      'packages/context/src/utils',
      'packages/context/src/helpers',
      'packages/context/src/managers',
      'packages/context/src/types',
    ]) {
      expect(exists(forbidden), forbidden).toBe(false);
    }
    // Old files and forwarders are fully replaced by the target structure.
    for (const legacy of [
      'packages/context/src/context-messages.ts',
      'packages/context/src/system-prompt.ts',
      'packages/context/src/image-content.ts',
      'packages/context/src/xml-escape.ts',
      'packages/context/src/context-usage.ts',
      'packages/context/src/compaction/compaction-summary.ts',
    ]) {
      expect(exists(legacy), legacy).toBe(false);
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

  it('keeps ContextBuilder free of direct source reads, attachment reads and message conversion', () => {
    const builderSource = read('packages/context/src/context-builder.ts');
    // The builder coordinates through the internal owners only.
    expect(builderSource).toContain('this.resolver.resolve');
    expect(builderSource).toContain('this.promptBuilder.build');
    expect(builderSource).not.toMatch(
      /readWorkspace\(|getSystemInstructions\(|getEffectiveInstructions\(|createView\(|readAttachmentContent\(|buildContextMessages\(/u,
    );
    // The same-Session serial tail is removed once the last operation settles.
    expect(builderSource).toMatch(/sessionOperationTails\.delete\(sessionId\)/);
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
    expect(contextSource).toContain('ContextResolver');
    expect(contextSource).toContain("readWorkspace({");
    expect(contextSource).toContain('getEffectiveInstructions(');
    expect(contextSource).toContain('skills.createView(');
    // Engine and Product no longer read these sources for Context.
    expect(read('packages/engine/src/agent-loop.ts')).not.toContain('scopeResolver');
    expect(read('packages/engine/src/agent-loop.ts')).not.toMatch(/getEffectiveInstructions|createView/u);
    expect(read('packages/product/src/product.ts')).not.toContain('scopeResolver');
  });

  it('keeps the internal dependency directions one-way', () => {
    // The Resolver owns source reads and never imports Prompt, Policy or Compaction.
    const resolverSource = read('packages/context/src/context-resolver.ts');
    expect(resolverSource).not.toMatch(/from ['"][^'"]*(prompt\/|context-policy|compaction)[^'"]*['"]/u);
    expect(resolverSource).not.toContain('PromptBuilder');
    // The PromptBuilder depends on the resolved context and message materialization only.
    const promptBuilderSource = read('packages/context/src/prompt/prompt-builder.ts');
    expect(promptBuilderSource).not.toMatch(/from ['"][^'"]*(context-policy|compaction)[^'"]*['"]/u);
    expect(promptBuilderSource).not.toMatch(/from ['"][^'"]*ModelCallContext['"]/u);
    expect(promptBuilderSource).not.toMatch(/from ['"][^'"]*Model<Api>['"]/u);
    expect(promptBuilderSource).not.toMatch(/from ['"][^'"]*@megumi\/ai['"]/u);
    // The Compactor never depends on ContextBuilder.
    const compactorSource = read('packages/context/src/compaction/context-compactor.ts');
    expect(compactorSource).not.toMatch(/from ['"][^'"]*context-builder['"]/u);
    // Engine and Product never deep-import Context internals.
    const engineSource = readTree('packages/engine/src');
    const productSource = readTree('packages/product/src');
    expect(engineSource).not.toMatch(/@megumi\/context\/(?!['"])/u);
    expect(productSource).not.toMatch(/@megumi\/context\/(?!['"])/u);
  });

  it('keeps usage calculation on the complete Prompt and the compaction request bus-free', () => {
    const contextSource = readTree('packages/context/src');
    // The Usage entry never falls back to estimating only prompt.messages.
    expect(contextSource).not.toMatch(/estimateContextTokens\(prompt\.messages\)/u);
    expect(contextSource).not.toMatch(/estimateContextTokens\(result\.prompt\.messages\)/u);
    expect(contextSource).toContain('estimateContextTokens(');
    // The compaction request no longer carries an EventBus; the bus is a
    // creation-time dependency only.
    const requestContract = read('packages/context/src/context.ts');
    expect(requestContract).toMatch(/interface CompactContextRequest/u);
    expect(requestContract).not.toMatch(/CompactContextRequest[\s\S]*events/u);
    expect(requestContract).toContain('readonly tools: readonly ToolDefinition[]');
  });

  it('keeps ResolvedContext limited to Prompt-building facts', () => {
    const resolverSource = read('packages/context/src/context-resolver.ts');
    const resolvedBlock = resolverSource.match(/interface ResolvedContext \{[\s\S]*?\}/u)?.[0] ?? '';
    // No run identities, user input, full Model object or operation controls
    // inside the resolved facts (the resolve Request may carry them).
    expect(resolvedBlock).not.toMatch(/runId|modelCallId|userInput/u);
    expect(resolvedBlock).not.toMatch(/model[?]?:|signal[?]?:/u);
    expect(resolvedBlock).toContain('readonly imageInputSupport: boolean');
    expect(resolvedBlock).toContain('readonly tools: readonly ToolDefinition[]');
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
