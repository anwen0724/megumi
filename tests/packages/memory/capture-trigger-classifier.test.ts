import { describe, expect, it } from 'vitest';
import { evaluateMemoryCaptureTrigger } from '@megumi/memory';

const baseInput = {
  runStatus: 'completed' as const,
  memoryEnabled: true,
  hasProject: true,
  userText: '请记住：这个项目的文档默认使用中文。',
  assistantFinalText: '我会按这个约定执行。',
  now: '2026-06-12T00:00:00.000Z',
};

describe('memory capture trigger classifier', () => {
  it('extracts on explicit Chinese remember signal', () => {
    expect(evaluateMemoryCaptureTrigger(baseInput)).toMatchObject({
      shouldExtract: true,
      signals: ['explicit_remember', 'project_rule'],
      reason: 'strong_signal',
    });
  });

  it('extracts on English future preference signal', () => {
    expect(evaluateMemoryCaptureTrigger({
      ...baseInput,
      userText: 'Please remember that I prefer concise answers in future architecture reviews.',
    })).toMatchObject({
      shouldExtract: true,
      signals: expect.arrayContaining(['explicit_remember', 'future_preference']),
    });
  });

  it('does not extract on a bare agreement without decision context', () => {
    expect(evaluateMemoryCaptureTrigger({
      ...baseInput,
      userText: '同意',
      conversationMarkers: { hasRecentProposal: false },
    })).toMatchObject({
      shouldExtract: false,
      reason: 'no_long_term_signal',
    });
  });

  it('extracts a confirmed decision only when context markers support it', () => {
    expect(evaluateMemoryCaptureTrigger({
      ...baseInput,
      userText: '同意，就这么定',
      conversationMarkers: { hasRecentProposal: true },
    })).toMatchObject({
      shouldExtract: true,
      signals: ['confirmed_decision'],
    });
  });

  it('skips failed, cancelled, interrupted runs and runs without final answer', () => {
    expect(evaluateMemoryCaptureTrigger({ ...baseInput, runStatus: 'failed' })).toMatchObject({
      shouldExtract: false,
      reason: 'run_not_completed',
    });
    expect(evaluateMemoryCaptureTrigger({ ...baseInput, assistantFinalText: '' })).toMatchObject({
      shouldExtract: false,
      reason: 'missing_assistant_final_text',
    });
  });

  it('uses tool/source metadata for stable facts and source-of-truth changes', () => {
    expect(evaluateMemoryCaptureTrigger({
      ...baseInput,
      userText: '检查一下文档。',
      toolActivity: {
        hasStableProjectFact: true,
        changedSourceOfTruthDocs: ['.local-docs/specs/example.md'],
      },
    })).toMatchObject({
      shouldExtract: true,
      signals: expect.arrayContaining(['stable_project_fact', 'source_of_truth_doc_changed']),
    });
  });

  it('applies cooldown to weak stable facts but not strong signals', () => {
    const lastCaptureAt = '2026-06-11T23:59:30.000Z';
    expect(evaluateMemoryCaptureTrigger({
      ...baseInput,
      userText: '普通问答',
      toolActivity: { hasStableProjectFact: true },
      lastCaptureAt,
      cooldownMs: 120_000,
    })).toMatchObject({
      shouldExtract: false,
      reason: 'cooldown_active',
    });
    expect(evaluateMemoryCaptureTrigger({
      ...baseInput,
      userText: '请记住：以后先写 spec。',
      lastCaptureAt,
      cooldownMs: 120_000,
    }).shouldExtract).toBe(true);
  });
});
