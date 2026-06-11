// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('run context and model input boundaries', () => {
  it('keeps context-management independent from full RunContext', () => {
    const source = read('packages/context-management/model-step-input-context.ts');

    expect(source).not.toContain('@megumi/shared/run-context-contracts');
    expect(source).not.toContain('RunContext');
    expect(source).not.toContain('runContext?:');
    expect(source).not.toContain('input.runContext');
  });

  it('keeps RunContext free of final budget result fields', () => {
    const source = read('packages/shared/run-context-contracts.ts');

    expect(source).toContain('contextBudgetPolicy: ContextBudgetPolicySchema');
    expect(source).not.toContain('ContextBudgetSchema');
    expect(source).not.toContain('availableInputTokens');
    expect(source).not.toContain('budget: ContextBudget');
  });

  it('keeps ModelStepRuntimeRequest inputContext as the only prompt carrier', () => {
    const source = read('packages/shared/model-step-contracts.ts');

    expect(source).toContain('inputContext: ModelInputContext');
    expect(source).not.toMatch(/\bmessages\?:/);
    expect(source).not.toMatch(/\bcontext\?:\s*RunContext/);
    expect(source).not.toMatch(/\btoolCalls\?:/);
    expect(source).not.toMatch(/\btoolResults\?:/);
    expect(source).not.toMatch(/\bproviderStates\?:/);
    expect(source).not.toMatch(/\bmodeSnapshot\?:/);
  });

  it('keeps main as the RunContext to ModelInputContext adapter', () => {
    const contextManagement = read('packages/context-management/model-step-input-context.ts');
    const sessionRun = read('apps/desktop/src/main/services/session-run.service.ts');

    expect(contextManagement).toContain('runtimeConstraints?: ModelStepRuntimeConstraintInput[]');
    expect(sessionRun).toContain('runtimeConstraintsFromRunContext');
    expect(sessionRun).toMatch(/context\??\.contextBudgetPolicy/);
  });

  it('keeps input intent materialization in context-management and out of provider adapters', () => {
    const contextSource = read('packages/context-management/model-step-input-context.ts');
    const providerSource = read('packages/ai/prompt/model-input-context-mapper.ts');

    expect(contextSource).toContain('inputIntent');
    expect(contextSource).toContain("instructionKind: 'intent'");
    expect(providerSource).not.toContain('InputIntentCommandMetadata');
    expect(providerSource).not.toContain('input-command-contracts');
  });
});
