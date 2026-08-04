/* XML attribute escaping and cancelled failures shared by Context prompt materializers. */
import type { ContextFailure } from './context';

export function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function cancelledFailure(message: string): ContextFailure {
  return {
    code: 'cancelled',
    message,
    retryable: true,
  };
}
