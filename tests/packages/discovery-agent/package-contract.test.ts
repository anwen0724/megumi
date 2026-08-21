/* Guards the Discovery Agent Package surface and its fixed physical shape. */
// @vitest-environment node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as discoveryAgentPackage from '@megumi/discovery-agent';

const root = process.cwd();
const packageRoot = join(root, 'packages/discovery-agent');

describe('@megumi/discovery-agent public contract', () => {
  it('exports only the construction entry at runtime', () => {
    expect(Object.keys(discoveryAgentPackage).sort()).toEqual(['createDiscoveryAgent']);
  });

  it('keeps only the Spec-fixed source files without prebuilt business modules', () => {
    expect(readdirSync(join(packageRoot, 'src')).sort()).toEqual([
      'discovery-agent.ts',
      'execution',
      'index.ts',
    ]);
    expect(readdirSync(join(packageRoot, 'src/execution')).sort()).toEqual([
      'context-adapter.ts',
      'execute-agent.ts',
      'execution-observer.ts',
      'execution-registry.ts',
      'session-settlement.ts',
      'tool-adapter.ts',
    ]);
    const businessDirectories = [
      'discovery', 'recommendation', 'feedback', 'scheduling', 'delivery',
      'runtime', 'harness', 'manager',
    ];
    for (const directory of businessDirectories) {
      expect(existsSync(join(packageRoot, 'src', directory))).toBe(false);
    }
  });

  it('does not export execution records, launch seams, approval continuations or reservations', () => {
    const index = readFileSync(join(packageRoot, 'src/index.ts'), 'utf8');
    expect(index).not.toMatch(
      /\b(?:ActiveExecution|TerminalExecution|PendingApproval|ExecutionRegistry|reserveStart|RequestFingerprint|ExecutionMetadata|ExecutionOutcome|LaunchAgentExecution|LaunchedAgentExecution|LaunchAgentExecutionInput|ApprovalRequest|ApprovalResolution)\b/u,
    );
  });

  it('depends only on capability packages, never on Engine or Product', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@megumi/agent',
      '@megumi/ai',
      '@megumi/context',
      '@megumi/events',
      '@megumi/input',
      '@megumi/observability',
      '@megumi/permissions',
      '@megumi/session',
      '@megumi/tools',
    ]);
    const sources = [
      readFileSync(join(packageRoot, 'src/index.ts'), 'utf8'),
      readFileSync(join(packageRoot, 'src/discovery-agent.ts'), 'utf8'),
      readFileSync(join(packageRoot, 'src/execution/execution-registry.ts'), 'utf8'),
    ].join('\n');
    for (const forbidden of ['@megumi/engine', '@megumi/product', '@megumi/workspace']) {
      expect(sources).not.toContain(`from '${forbidden}`);
    }
  });
});
