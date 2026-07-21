/*
 * Guards the Context v2 package structure and stable public surface.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readTree(relativePath: string): string {
  const absolutePath = path.join(root, relativePath);
  return fs.readdirSync(absolutePath, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8'))
    .join('\n');
}

function listFiles(relativePath: string): string[] {
  const absolutePath = path.join(root, relativePath);
  return fs.readdirSync(absolutePath, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(absolutePath, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort();
}

describe('Context system v2 source guards', () => {
  it('provides the target domain and service contract files', () => {
    expect(listFiles('packages/agent/context')).toEqual([
      'config/compose-agent-context.ts',
      'domain/dto/agent-run/context-agent-run-request.ts',
      'domain/dto/agent-run/context-agent-run-response.ts',
      'domain/dto/command/context-command-request.ts',
      'domain/dto/command/context-command-response.ts',
      'domain/dto/ui/context-ui-request.ts',
      'domain/dto/ui/context-ui-response.ts',
      'domain/model/active-context.ts',
      'domain/model/compaction.ts',
      'domain/model/context-usage.ts',
      'domain/model/conversation-run.ts',
      'domain/model/prompt.ts',
      'index.ts',
      'service/context-service-impl.ts',
      'service/context-service-types.ts',
      'service/context-service.ts',
      'service/internal/active-context-builder.ts',
      'service/internal/compaction-planner.ts',
      'service/internal/compaction-summary-builder.ts',
      'service/internal/context-usage-calculator.ts',
      'service/internal/conversation-run-builder.ts',
      'service/internal/conversation-run-items.ts',
      'service/internal/image-content-materializer.ts',
      'service/internal/prompt-builder.ts',
    ]);
    expect(exists('packages/agent/context/domain/model/active-context.ts')).toBe(true);
    expect(exists('packages/agent/context/domain/model/prompt.ts')).toBe(true);
    expect(exists('packages/agent/context/domain/model/conversation-run.ts')).toBe(true);
    expect(exists('packages/agent/context/domain/model/context-usage.ts')).toBe(true);
    expect(exists('packages/agent/context/domain/model/compaction.ts')).toBe(true);
    expect(exists('packages/agent/context/service/context-service.ts')).toBe(true);
    expect(exists('packages/agent/context/service/context-service-types.ts')).toBe(true);
    expect(exists('packages/agent/context/service/context-service-impl.ts')).toBe(true);
    expect(exists('packages/agent/context/config/compose-agent-context.ts')).toBe(true);
    expect(exists('packages/agent/context/domain/dto/agent-run/context-agent-run-request.ts')).toBe(true);
    expect(exists('packages/agent/context/domain/dto/agent-run/context-agent-run-response.ts')).toBe(true);
    expect(exists('packages/agent/context/domain/dto/command/context-command-request.ts')).toBe(true);
    expect(exists('packages/agent/context/domain/dto/command/context-command-response.ts')).toBe(true);
    expect(exists('packages/agent/context/domain/dto/ui/context-ui-request.ts')).toBe(true);
    expect(exists('packages/agent/context/domain/dto/ui/context-ui-response.ts')).toBe(true);
    for (const internalFile of [
      'active-context-builder.ts',
      'conversation-run-builder.ts',
      'prompt-builder.ts',
      'context-usage-calculator.ts',
      'compaction-planner.ts',
      'compaction-summary-builder.ts',
    ]) {
      expect(exists(`packages/agent/context/service/internal/${internalFile}`)).toBe(true);
    }
  });

  it('exports only the stable public surface', () => {
    const publicIndex = read('packages/agent/context/index.ts');
    const composition = read('packages/agent/context/config/compose-agent-context.ts');

    expect(publicIndex).not.toContain('/internal/');
    expect(publicIndex).not.toContain('context-service-impl');
    expect(publicIndex).not.toContain('UsageMonitor');
    expect(publicIndex).not.toContain('signalBus');
    expect(publicIndex).not.toContain('./contracts/');
    expect(publicIndex).not.toContain('./core/');
    expect(publicIndex).not.toContain('./services/');
    expect(composition).toMatch(/contextService:\s*ContextService[;\n]/);
    expect(composition).not.toMatch(/contextService:\s*ContextServiceImpl/);
  });

  it('does not create repository or ports layers', () => {
    expect(exists('packages/agent/context/repository')).toBe(false);
    expect(exists('packages/agent/context/ports')).toBe(false);
  });

  it('removes the legacy Context layers and composition surfaces', () => {
    expect(exists('packages/agent/context/contracts')).toBe(false);
    expect(exists('packages/agent/context/core')).toBe(false);
    expect(exists('packages/agent/context/services')).toBe(false);
    expect(exists('packages/agent/composition/context-repository.ts')).toBe(false);
    expect(exists('packages/agent/composition/compose-agent-context.ts')).toBe(false);
  });

  it('keeps Context independent of settings, providers, hosts, persistence, and repositories', () => {
    const contextSource = readTree('packages/agent/context');

    expect(contextSource).not.toMatch(/from ['"][^'"]*settings/i);
    expect(contextSource).not.toMatch(/from ['"][^'"]*provider/i);
    expect(contextSource).not.toMatch(/from ['"][^'"]*(electron|desktop|preload|renderer)/i);
    expect(contextSource).not.toMatch(/from ['"]node:(fs|path)/i);
    expect(contextSource).not.toMatch(/better-sqlite3|sqlite/i);
    expect(contextSource).not.toMatch(/from ['"][^'"]*repositor/i);
    expect(contextSource).not.toContain('256_000');
  });

  it('has no usage monitor, signal, or subscription implementation', () => {
    const contextSource = readTree('packages/agent/context');

    expect(contextSource).not.toMatch(/ContextUsageMonitor|contextUsageSignalBus|ContextUsageSignal/);
    expect(contextSource).not.toMatch(/subscribeContextUsage|unsubscribeContextUsage/);
    expect(contextSource).not.toMatch(/ContextUsageSubscription|\.subscribe\(|\.unsubscribe\(/);
  });

  it('uses fixed recent-Run retention instead of threshold-seeking prefix estimates', () => {
    const contextSource = readTree('packages/agent/context');

    expect(contextSource).toContain('keepRecentRuns');
    expect(contextSource).not.toMatch(/previousSummaryInputTokens|nonCompressibleInputTokens|historicalTurnInputTokens|thresholdInputTokens/);
  });

  it('keeps Prompt.tools as the only model-facing tool input', () => {
    const agentRunSource = readTree('packages/agent/agent-run');

    expect(agentRunSource).not.toMatch(/model_call_messages|tool_set|toolSet/);
  });

  it('keeps Host Context Usage as a snapshot-only query', () => {
    const hostSource = read('packages/product/host-interface/chat-host.ts');

    expect(hostSource).toContain('getSessionUsageSnapshot');
    expect(hostSource).not.toMatch(/refreshAndGetSessionUsage|contextUsageWindowProvider|request\.refresh/);
  });
});
