/* Guards Candidate Supply's Agent, Source, Pool, and Observability ownership boundaries. */
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Candidate Supply architecture boundaries', () => {
  it('keeps Source calls inside Tool operations rather than Runtime planning', () => {
    const runtime = read('packages/agent/discovery/src/candidate-supply/candidate-supply-runtime.ts');
    const attempts = read('packages/agent/discovery/src/candidate-supply/candidate-supply-attempts.ts');
    expect(runtime).not.toContain('.search({');
    expect(runtime).not.toContain('.read!({');
    expect(attempts).toContain('source.search({');
    expect(attempts).toContain('source.read!({');
  });

  it('does not introduce a second Agent loop, plan entity, or Trace store', () => {
    const supply = [
      read('packages/agent/discovery/src/candidate-supply/candidate-supply-runtime.ts'),
      read('packages/agent/discovery/src/candidate-supply/candidate-supply-attempts.ts'),
      read('packages/agent/discovery/src/candidate-supply/candidate-supply.ts'),
    ].join('\n');
    for (const forbidden of ['new Agent(', 'PlanItem', 'planItemId', 'TraceJournal', 'startTrace(']) {
      expect(supply, forbidden).not.toContain(forbidden);
    }
    expect(supply).toContain("kind: 'candidate_supply'");
    expect(supply).toContain('commitAdmission');
  });
});

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}
