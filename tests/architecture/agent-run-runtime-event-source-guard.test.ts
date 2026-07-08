// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

const NORMALIZE_RUNTIME_EVENT_PAYLOAD = ['normalize', 'Runtime', 'Event', 'Payload'].join('');
const NORMALIZED_RUNTIME_EVENT_PAYLOAD = ['Normalized', 'Runtime', 'Event', 'Payload'].join('');
const TOOL_EXECUTION_PREFIX = ['tool', 'execution'].join('_') + '.';
const TOOL_RESULT_FACTS_SUBMITTED = ['tool', 'result', 'facts'].join('_') + '.submitted';

describe('Agent Run RuntimeEvent source boundary', () => {
  it('does not normalize internal event names into RuntimeEvent at service boundary', () => {
    const service = readSource('packages/coding-agent/agent-run/services/agent-run-service.ts');

    expect(service).not.toContain(NORMALIZE_RUNTIME_EVENT_PAYLOAD);
    expect(service).not.toContain(NORMALIZED_RUNTIME_EVENT_PAYLOAD);
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
    expect(orchestrator).not.toContain(TOOL_EXECUTION_PREFIX);
    expect(orchestrator).not.toContain(TOOL_RESULT_FACTS_SUBMITTED);
    expect(service).not.toContain(TOOL_EXECUTION_PREFIX);
    expect(service).not.toContain(TOOL_RESULT_FACTS_SUBMITTED);
  });
});
