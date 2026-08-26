/* Guards the completed Trace migration against legacy APIs, formats, and reverse dependencies. */
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const productionRoots = ['packages', 'apps', 'evals'] as const;
const traceProducerRoots = [
  'packages/agent/execution/src',
  'packages/agent/context/src',
  'packages/agent/discovery/src',
] as const;

describe('Trace system architecture boundaries', () => {
  it('removes the legacy handle/service API and implementation tree', () => {
    const production = readTrees(productionRoots);
    for (const symbol of [
      'ObservabilityService', 'TraceHandle', 'SpanHandle',
      'startTrace', 'endTrace', 'startSpan', 'endSpan',
      'runInTraceContext', 'runInSpanContext',
    ]) {
      expect(production, symbol).not.toContain(symbol);
    }
    for (const relativePath of [
      'packages/agent/observability/src/config',
      'packages/agent/observability/src/domain',
      'packages/agent/observability/src/service',
      'packages/agent/observability/src/storage',
      'packages/agent/observability/src/runtime-logger.ts',
      'tests/packages/observability/observability-system.test.ts',
      'tests/packages/observability/redaction.test.ts',
      'tests/packages/execution/execution-observer.test.ts',
    ]) {
      expect(fs.existsSync(path.join(root, relativePath)), relativePath).toBe(false);
    }
  });

  it('keeps legacy format markers inside the read-only Legacy Reader', () => {
    const markers = ['observability.jsonl', 'legacy diagnostic', 'LegacyObservabilityRecord'];
    for (const marker of markers) {
      expect(filesContaining('packages/agent/observability/src', marker)).toEqual([
        'packages/agent/observability/src/query/legacy-trace-reader.ts',
      ]);
    }
    const legacyReader = read('packages/agent/observability/src/query/legacy-trace-reader.ts');
    expect(legacyReader).not.toContain("from './trace-projector'");
    expect(legacyReader).not.toContain('projectTrace(');
  });

  it('keeps the write API to five callback-scoped operations with closed Span and Event types', () => {
    const contract = read('packages/agent/observability/src/trace/observability.ts');
    const interfaceBody = contract.match(/export interface Observability \{([\s\S]*?)\n\}/u)?.[1] ?? '';
    const methods = [...interfaceBody.matchAll(/^\s{2}(\w+)(?:<[^>]+>)?\(/gmu)]
      .map((match) => match[1]);
    expect(methods).toEqual(['withTrace', 'withSpan', 'recordContent', 'recordEvent', 'linkTrace']);
    expect(contract).toContain('name: SpanName');
    expect(interfaceBody).toContain('recordEvent(event: TraceEvent)');

    const traceContract = read('packages/agent/observability/src/trace/trace-contract.ts');
    expect(traceContract).toContain('SpanNameSchema = z.enum(TRACE_SPAN_NAMES)');
    expect(traceContract).toContain("z.discriminatedUnion('type'");
    for (const legacyName of ['agent_run', 'approval.wait', 'session.append_message']) {
      expect(traceContract, legacyName).not.toContain(legacyName);
    }
  });

  it('keeps AI and Tools unaware of Observability and Trace producers on the public write seam', () => {
    expect(readTrees(['packages/ai/src', 'packages/agent/tools/src'])).not.toContain('@megumi/observability');
    const producers = readTrees(traceProducerRoots);
    expect(producers).not.toMatch(/@megumi\/observability\//u);
    for (const readType of [
      'TraceProjection', 'TraceReader', 'ObservabilityQueries',
      'listTraces(', 'getTrace(', 'readContent(', 'rebuildIndex(', 'createDiagnosticBundle(',
    ]) {
      expect(producers, readType).not.toContain(readType);
    }
  });

  it('keeps Runtime Log, Journal, and Derived Index as separate persistence contracts', () => {
    const runtimeLogger = read('packages/agent/observability/src/runtime/runtime-logger.ts');
    expect(runtimeLogger).not.toContain('trace-journal');
    expect(runtimeLogger).not.toContain('TraceJournalRecord');

    const journalSchema = read('packages/agent/observability/src/persistence/trace-journal-record.ts');
    for (const legacyEncoding of [
      "type: z.literal('log')", "type: z.literal('measurement')",
      'attributes:', "name: z.literal('agent_run')", 'durationMs:',
    ]) {
      expect(journalSchema, legacyEncoding).not.toContain(legacyEncoding);
    }

    const index = read('packages/agent/observability/src/persistence/trace-index.ts');
    const contentsTable = index.match(/`CREATE TABLE contents \(([\s\S]*?)\n\s*\)`,/u)?.[1] ?? '';
    expect(contentsTable).not.toMatch(/\b(?:body|bytes|payload|json|value)\b/u);
    expect(contentsTable).toContain('content_id TEXT');
    expect(contentsTable).toContain('media_type TEXT');
  });

  it('prevents Trace read results from becoming business branch inputs', () => {
    const businessOwners = readTrees([
      ...traceProducerRoots,
      'packages/agent/product-host/src/operations/session',
      'packages/agent/product-host/src/operations/discovery-operations.ts',
    ]);
    for (const readOperation of [
      '.listTraces(', '.getTrace(', '.readContent(', '.getHealth(',
      '.rebuildIndex(', '.listLegacyDiagnostics(', '.createDiagnosticBundle(',
    ]) {
      expect(businessOwners, readOperation).not.toContain(readOperation);
    }
  });
});

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readTrees(relativeRoots: readonly string[]): string {
  return relativeRoots.flatMap((relativeRoot) => sourceFiles(path.join(root, relativeRoot)))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
}

function filesContaining(relativeRoot: string, marker: string): string[] {
  return sourceFiles(path.join(root, relativeRoot))
    .filter((file) => fs.readFileSync(file, 'utf8').includes(marker))
    .map((file) => path.relative(root, file).replaceAll('\\', '/'))
    .sort();
}

function sourceFiles(target: string): string[] {
  if (!fs.existsSync(target)) return [];
  const entry = fs.statSync(target);
  if (entry.isFile()) return /\.(?:ts|tsx|mts|cts)$/u.test(target) ? [target] : [];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((child) => {
    if (child.name === 'node_modules' || child.name === 'dist' || child.name.startsWith('.')) return [];
    return sourceFiles(path.join(target, child.name));
  });
}
