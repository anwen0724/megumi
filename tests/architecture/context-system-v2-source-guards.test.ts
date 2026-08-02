/* Guards the Context Package structure, stable exports, and Owner boundaries. */
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Context Package source guards', () => {
  it('provides the confirmed Context Package files', () => {
    expect(listFiles('packages/context/src')).toEqual([
      'active-context.ts',
      'compaction/compaction-planner.ts',
      'compaction/compaction-summary.ts',
      'compaction/context-compactor.ts',
      'context-builder.ts',
      'context-policy.ts',
      'context-usage.ts',
      'conversation-run.ts',
      'image-content.ts',
      'index.ts',
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
      'ContextUsageReader',
      'ContextUsageRecorder',
    ]) {
      expect(publicIndex).toContain(required);
    }
    expect(publicIndex).not.toMatch(/ContextService|context-service|compaction-planner|compaction-summary|image-content/u);
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
    expect(source).not.toMatch(/from ['"](?:node:|electron)|apps[\\/]desktop/u);
    expect(source).not.toMatch(/better-sqlite3|sqlite|Repository/u);
    expect(source).not.toContain('256_000');
  });

  it('keeps usage snapshot reads side-effect free and compaction retention policy explicit', () => {
    const contextSource = readTree('packages/context/src');
    const hostSource = read('packages/product/src/host/chat-host.ts');

    expect(contextSource).toContain('keepRecentRuns');
    expect(contextSource).not.toMatch(/ContextUsageMonitor|subscribeContextUsage|unsubscribeContextUsage/u);
    expect(hostSource).not.toMatch(/refreshAndGetSessionUsage|contextUsageWindowProvider|request\.refresh/u);
  });

  it('keeps Context.tools as the only model-facing Tool input', () => {
    const engineSource = readTree('packages/engine/src');

    expect(engineSource).not.toMatch(/model_call_messages|tool_set|toolSet/u);
    expect(engineSource).toContain('tools: modelVisibleToolDefinitions(toolResolution.definitions)');
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
