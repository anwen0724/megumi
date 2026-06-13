// Classifies whether a completed run should start memory extraction. This is
// deterministic and intentionally does not call an LLM or inspect persistence.
import type { MemoryCaptureSignal } from '@megumi/shared/memory';
import { normalizeMemoryPatternText } from './text-normalization';

export type MemoryCaptureRunStatus = 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'running';

export interface MemoryCaptureTriggerInput {
  runStatus: MemoryCaptureRunStatus;
  memoryEnabled: boolean;
  hasProject: boolean;
  userText: string;
  assistantFinalText?: string | null;
  toolActivity?: {
    hasStableProjectFact?: boolean;
    changedSourceOfTruthDocs?: string[];
  };
  conversationMarkers?: {
    hasRecentProposal?: boolean;
  };
  now: string;
  lastCaptureAt?: string | null;
  cooldownMs?: number;
}

export interface MemoryCaptureTriggerDecision {
  shouldExtract: boolean;
  signals: MemoryCaptureSignal[];
  reason:
    | 'memory_disabled'
    | 'run_not_completed'
    | 'missing_assistant_final_text'
    | 'no_long_term_signal'
    | 'cooldown_active'
    | 'strong_signal'
    | 'weak_signal';
}

const STRONG_SIGNALS = new Set<MemoryCaptureSignal>([
  'explicit_remember',
  'explicit_forget_or_correction',
  'confirmed_decision',
  'project_rule',
  'source_of_truth_doc_changed',
]);

const SCOPED_CAPTURE_SIGNALS = new Set<MemoryCaptureSignal>([
  'project_rule',
  'stable_project_fact',
  'source_of_truth_doc_changed',
]);

export function evaluateMemoryCaptureTrigger(input: MemoryCaptureTriggerInput): MemoryCaptureTriggerDecision {
  if (!input.memoryEnabled) {
    return skip('memory_disabled');
  }
  if (input.runStatus !== 'completed') {
    return skip('run_not_completed');
  }
  if (!input.assistantFinalText?.trim()) {
    return skip('missing_assistant_final_text');
  }

  const text = normalizeMemoryPatternText(`${input.userText} ${input.assistantFinalText ?? ''}`);
  const signals = collectSignals(text, input).filter((signal) => input.hasProject || !SCOPED_CAPTURE_SIGNALS.has(signal));
  if (signals.length === 0) {
    return skip('no_long_term_signal');
  }

  const hasStrongSignal = signals.some((signal) => STRONG_SIGNALS.has(signal));
  if (!hasStrongSignal && isCooldownActive(input)) {
    return { shouldExtract: false, signals, reason: 'cooldown_active' };
  }

  return {
    shouldExtract: true,
    signals,
    reason: hasStrongSignal ? 'strong_signal' : 'weak_signal',
  };
}

function collectSignals(text: string, input: MemoryCaptureTriggerInput): MemoryCaptureSignal[] {
  const signals = new Set<MemoryCaptureSignal>();
  if (matchesAny(text, ['记住', '以后记得', '请保存', 'remember this', 'please remember', 'make a note'])) {
    signals.add('explicit_remember');
  }
  if (matchesAny(text, ['忘掉', '不要再记', '不是', '更正', 'correction', 'forget', 'do not remember'])) {
    signals.add('explicit_forget_or_correction');
  }
  if (matchesAny(text, ['以后', '今后', '我希望', '偏好', 'prefer', 'in future', 'always'])) {
    signals.add('future_preference');
  }
  if (matchesAny(text, ['项目约定', '命名规范', '必须', '禁止', '默认使用', 'project rule', 'must', 'forbidden', 'by default'])) {
    signals.add('project_rule');
  }
  if (input.conversationMarkers?.hasRecentProposal && matchesAny(text, ['同意', '确认', '就这么定', 'approved', 'confirmed', 'sounds good'])) {
    signals.add('confirmed_decision');
  }
  if (input.toolActivity?.hasStableProjectFact) {
    signals.add('stable_project_fact');
  }
  if ((input.toolActivity?.changedSourceOfTruthDocs ?? []).length > 0) {
    signals.add('source_of_truth_doc_changed');
  }
  return [...signals];
}

function matchesAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(normalizeMemoryPatternText(pattern)));
}

function isCooldownActive(input: MemoryCaptureTriggerInput): boolean {
  if (!input.lastCaptureAt || !input.cooldownMs) {
    return false;
  }
  return Date.parse(input.now) - Date.parse(input.lastCaptureAt) < input.cooldownMs;
}

function skip(reason: MemoryCaptureTriggerDecision['reason']): MemoryCaptureTriggerDecision {
  return { shouldExtract: false, signals: [], reason };
}
