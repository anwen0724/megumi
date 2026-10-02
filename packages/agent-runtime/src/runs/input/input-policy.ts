/*
 * Defines the fixed input limits exposed to hosts and enforced by Input.
 */

export type SupportedImageMediaType = "image/png" | "image/jpeg" | "image/webp";

export type SupportedDocumentMediaType =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "text/plain"
  | "text/markdown";

export interface ImageInputPolicy {
  readonly allowedMediaTypes: readonly SupportedImageMediaType[];
  readonly maxImageCount: number;
  readonly maxImageBytes: number;
  readonly maxTotalBytes: number;
}

export interface DocumentInputPolicy {
  readonly allowedMediaTypes: readonly SupportedDocumentMediaType[];
  readonly maxDocumentCount: number;
  readonly maxDocumentBytes: number;
}

export interface InputPolicy {
  readonly maxTextCharacters: number;
  readonly image: ImageInputPolicy;
  readonly document: DocumentInputPolicy;
}

export class InputPolicyConfigurationError extends Error {
  constructor(problems: readonly string[]) {
    super(`Input Policy is invalid: ${problems.join(' ')}`);
    this.name = 'InputPolicyConfigurationError';
  }
}

export function validateInputPolicy(policy: InputPolicy): string[] {
  const problems: string[] = [];
  const entries: Array<[string, number]> = [
    ['maxTextCharacters', policy.maxTextCharacters],
    ['image.maxImageCount', policy.image.maxImageCount],
    ['image.maxImageBytes', policy.image.maxImageBytes],
    ['image.maxTotalBytes', policy.image.maxTotalBytes],
    ['document.maxDocumentCount', policy.document.maxDocumentCount],
    ['document.maxDocumentBytes', policy.document.maxDocumentBytes],
  ];
  for (const [label, value] of entries) {
    if (!Number.isInteger(value) || value <= 0) {
      problems.push(`${label} must be a positive integer, got ${String(value)}.`);
    }
  }
  if (policy.image.maxTotalBytes < policy.image.maxImageBytes) {
    problems.push('image.maxTotalBytes must be >= image.maxImageBytes.');
  }
  return problems;
}

export const IMAGE_INPUT_POLICY: ImageInputPolicy = Object.freeze({
  allowedMediaTypes: ["image/png", "image/jpeg", "image/webp"] as const,
  maxImageCount: 5,
  maxImageBytes: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
});

export const DOCUMENT_INPUT_POLICY: DocumentInputPolicy = Object.freeze({
  allowedMediaTypes: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
  ] as const,
  maxDocumentCount: 10,
  maxDocumentBytes: 50 * 1024 * 1024,
});

export const DEFAULT_INPUT_POLICY: InputPolicy = Object.freeze({
  maxTextCharacters: 200_000,
  image: IMAGE_INPUT_POLICY,
  document: DOCUMENT_INPUT_POLICY,
});

export interface InputCapabilities {
  readonly maxTextCharacters: number;
  readonly allowedImageMediaTypes: readonly SupportedImageMediaType[];
  readonly maxImageCount: number;
  readonly maxImageBytes: number;
  readonly maxTotalImageBytes: number;
  readonly allowedDocumentMediaTypes: readonly SupportedDocumentMediaType[];
  readonly maxDocumentCount: number;
  readonly maxDocumentBytes: number;
}

export function inputCapabilities(policy: InputPolicy = DEFAULT_INPUT_POLICY): InputCapabilities {
  return {
    maxTextCharacters: policy.maxTextCharacters,
    allowedImageMediaTypes: [...policy.image.allowedMediaTypes],
    maxImageCount: policy.image.maxImageCount,
    maxImageBytes: policy.image.maxImageBytes,
    maxTotalImageBytes: policy.image.maxTotalBytes,
    allowedDocumentMediaTypes: [...policy.document.allowedMediaTypes],
    maxDocumentCount: policy.document.maxDocumentCount,
    maxDocumentBytes: policy.document.maxDocumentBytes,
  };
}
