// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('Agent Run RuntimeEvent source boundary', () => {
  it('does not normalize internal event names into RuntimeEvent at service boundary', () => {
    const service = readSource('packages/coding-agent/agent-run/services/agent-run-service.ts');

    expect(service).not.toContain('normalizeRuntimeEventPayload');
    expect(service).not.toContain('NormalizedRuntimeEventPayload');
    expect(service).not.toContain('stringPayload(payload');
    expect(service).not.toContain('toolResultKind(payload');
    expect(service).not.toContain('approvalDecision(payload');
    expect(service).not.toMatch(/emit\(type:\s*string,\s*payload/);
    expect(service).not.toMatch(/createRuntimeEvent\(\s*type:\s*string/);
  });

  it('does not emit agent-run runtime events using dynamic internal event names', () => {
    const orchestrator = readSource('packages/coding-agent/agent-run/core/run-orchestrator.ts');
    const service = readSource('packages/coding-agent/agent-run/services/agent-run-service.ts');

    expect(orchestrator).not.toContain('event_sink.emit(`model_call.${event.type}`');
    expect(orchestrator).not.toContain('tool_execution.');
    expect(orchestrator).not.toContain('tool_result_facts.submitted');
    expect(service).not.toContain('tool_execution.');
    expect(service).not.toContain('tool_result_facts.submitted');
  });
});
