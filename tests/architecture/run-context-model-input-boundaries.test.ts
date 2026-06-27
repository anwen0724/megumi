// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('run context and model input boundaries', () => {
  it('keeps coding-agent context independent from full RunContext', () => {
    const source = read('packages/coding-agent/run/context/model-call-context.ts');

    expect(source).not.toContain('@megumi/shared/run');
    expect(source).not.toContain('RunContext');
    expect(source).not.toContain('runContext?:');
    expect(source).not.toContain('input.runContext');
  });

  it('keeps RunContext free of final budget result fields', () => {
    const source = read('packages/shared/run/context-contracts.ts');

    expect(source).toContain('contextBudgetPolicy: ContextBudgetPolicySchema');
    expect(source).not.toContain('ContextBudgetSchema');
    expect(source).not.toContain('availableInputTokens');
    expect(source).not.toContain('budget: ContextBudget');
  });

  it('keeps ModelStepRuntimeRequest inputContext as the only prompt carrier', () => {
    const source = read('packages/shared/model/step-contracts.ts');

    expect(source).toContain('inputContext: ModelInputContext');
    expect(source).not.toMatch(/\bmessages\?:/);
    expect(source).not.toMatch(/\bcontext\?:\s*RunContext/);
    expect(source).not.toMatch(/\btoolCalls\?:/);
    expect(source).not.toMatch(/\btoolResults\?:/);
    expect(source).not.toMatch(/\bproviderStates\?:/);
    expect(source).not.toMatch(/\bmodeSnapshot\?:/);
  });

  it('keeps main as the RunContext to ModelStep input build adapter', () => {
    const contextManagement = read('packages/coding-agent/run/context/model-call-context.ts');
    const sessionRun = read('packages/coding-agent/run/agent-run-service.ts');

    expect(contextManagement).toContain('runtimeConstraints?: ModelStepRuntimeConstraintInput[]');
    expect(contextManagement).toMatch(/\bpermissionSnapshot\?:/);
    expect(contextManagement).toMatch(/\bpermissionSnapshotRef\?:/);
    expect(contextManagement).not.toMatch(/\bmodeSnapshot\?:/);
    expect(contextManagement).not.toMatch(/\bmodeSnapshotRef\?:/);
    expect(contextManagement).not.toMatch(/workflow-command-contracts/);
    expect(sessionRun).toContain('ModelStepInputBuildService');
    expect(sessionRun).toContain('modelStepInputBuildService');
    // contextBudgetPolicy resolution moved to RunTurn in packages/coding-agent/run.
    expect(sessionRun).toContain('RunTurn');
    const codingAgentRun = read('packages/coding-agent/run/turn/run-turn.ts');
    expect(codingAgentRun).toMatch(/contextBudgetPolicy/);
  });

  it('keeps input preprocessing materialization in coding-agent context and out of provider adapters', () => {
    const contextSource = read('packages/coding-agent/run/context/model-call-context.ts');
    const providerSource = read('packages/ai/providers/openai-compatible/openai-compatible-provider-adapter.ts');

    expect(contextSource).toContain('inputPreprocessing');
    expect(contextSource).toContain("instructionKind: 'prompt_template'");
    expect(contextSource).toContain("instructionKind: 'skill'");
    expect(contextSource).toContain("instructionKind: 'intent'");
    expect(providerSource).not.toContain('InputPreprocessingResult');
    expect(providerSource).not.toContain('InputIntentCommandMetadata');
    expect(providerSource).not.toContain('input-command-contracts');
  });

  it('preserves multi-level instruction source semantics in context materialization', () => {
    const contextSource = read('packages/coding-agent/run/context/model-call-context.ts');

    expect(contextSource).toContain('instructionKindForAgentSource');
    expect(contextSource).toContain('sessionInstructionParts');
    expect(contextSource).toContain('sourceKind: source.sourceKind');
    expect(contextSource).not.toContain("sourceKind: 'project_instruction',");
    expect(contextSource).not.toContain('part:instruction:project:${source.sourceId}');
  });

  it('keeps canonical model input source contracts in shared model contracts', () => {
    const sharedModel = read('packages/shared/model/input-context-contracts.ts');
    const contextSource = read('packages/coding-agent/run/context/model-call-context.ts');

    expect(sharedModel).toContain('MODEL_INPUT_CONTEXT_CANONICAL_SOURCE_KINDS');
    expect(sharedModel).toContain('ModelInputContextSourceSchema');
    expect(sharedModel).toContain('failureBehavior');
    expect(contextSource).not.toContain('ModelInputContextSourceSchema');
    expect(contextSource).not.toContain('MODEL_INPUT_CONTEXT_CANONICAL_SOURCE_KINDS');
  });
});
