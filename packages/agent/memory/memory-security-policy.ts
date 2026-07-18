// Applies conservative, pure safety checks before text can become memory.
// Runtime callers use this for both capture candidates and Markdown imports.
import { clipMemoryEvidenceQuote } from './text-normalization';

export type MemoryCandidateSafetySource = 'capture' | 'markdown_import';

export type MemorySafetyRejectReason =
  | 'secret_detected'
  | 'prompt_injection_detected'
  | 'sensitive_pii_detected'
  | 'entry_too_long'
  | 'empty_text';

export interface MemorySafetyInput {
  text: string;
  source: MemoryCandidateSafetySource;
}

export type MemorySafetyDecision =
  | { accepted: true; sanitizedText: string }
  | { accepted: false; reason: MemorySafetyRejectReason; redactedSnippet: string };

const MAX_MEMORY_TEXT_LENGTH = 4000;

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(api[_-]?key|access[_-]?token|token|secret|credential|password)\b\s*[:=]\s*\S+/i,
  /\bghp_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
];

const PROMPT_INJECTION_PATTERNS = [
  /\bignore (all )?(previous|prior) instructions\b/i,
  /\breveal (the )?(system prompt|developer message|hidden prompt)\b/i,
  /忽略(之前|以上|所有).*(指令|提示词)/,
  /(泄露|显示).*(系统提示词|隐藏提示词|开发者消息)/,
];

const SENSITIVE_PII_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b\d{16,19}\b/,
  /\b\d{6}(18|19|20)\d{2}(0[1-9]|1[0-2])([0-2]\d|3[01])\d{3}[\dXx]\b/,
];

export function sanitizeMemoryCandidateText(text: string): MemorySafetyDecision {
  return validateMemorySafety({ text, source: 'capture' });
}

export function validateMemorySafety(input: MemorySafetyInput): MemorySafetyDecision {
  const sanitizedText = input.text.replace(/\s+/g, ' ').trim();
  if (!sanitizedText) {
    return reject('empty_text', input.text);
  }
  if (sanitizedText.length > MAX_MEMORY_TEXT_LENGTH) {
    return reject('entry_too_long', sanitizedText);
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(sanitizedText))) {
    return reject('secret_detected', sanitizedText);
  }
  if (PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(sanitizedText))) {
    return reject('prompt_injection_detected', sanitizedText);
  }
  if (SENSITIVE_PII_PATTERNS.some((pattern) => pattern.test(sanitizedText))) {
    return reject('sensitive_pii_detected', sanitizedText);
  }
  return { accepted: true, sanitizedText };
}

function reject(reason: MemorySafetyRejectReason, text: string): MemorySafetyDecision {
  return {
    accepted: false,
    reason,
    redactedSnippet: clipMemoryEvidenceQuote(text.replace(/\S/g, '*'), 80),
  };
}
