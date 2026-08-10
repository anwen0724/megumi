/* Projects replace-style assistant reply snapshots into non-repeating speakable phrases. */

export interface SpokenTextSegment {
  readonly messageId: string;
  readonly text: string;
}

export interface SpokenStreamProjector {
  acceptSnapshot(input: { readonly messageId: string; readonly text: string }): void;
  finish(): void;
  reset(): void;
}

export function createSpokenStreamProjector(callbacks: {
  readonly emit: (segment: SpokenTextSegment) => void;
  readonly invalidate: (messageId: string) => void;
}): SpokenStreamProjector {
  const states = new Map<string, { raw: string; speakable: string; emittedLength: number }>();

  const emitReady = (messageId: string, state: { speakable: string; emittedLength: number }, flush: boolean) => {
    const remaining = state.speakable.slice(state.emittedLength);
    const boundaryLength = flush ? remaining.length : lastSpeakableBoundary(remaining);
    if (boundaryLength <= 0) return;
    const ready = remaining.slice(0, boundaryLength);
    for (const phrase of splitPhrases(ready)) {
      const text = cleanPhrase(phrase);
      if (text) callbacks.emit({ messageId, text });
    }
    state.emittedLength += boundaryLength;
  };

  return {
    acceptSnapshot(input) {
      const speakable = toSpeakableText(input.text);
      const previous = states.get(input.messageId);
      if (!previous) {
        const state = { raw: input.text, speakable, emittedLength: 0 };
        states.set(input.messageId, state);
        emitReady(input.messageId, state, false);
        return;
      }
      if (!input.text.startsWith(previous.raw) || !speakable.startsWith(previous.speakable)) {
        callbacks.invalidate(input.messageId);
        previous.raw = input.text;
        previous.speakable = speakable;
        previous.emittedLength = 0;
      } else {
        previous.raw = input.text;
        previous.speakable = speakable;
      }
      emitReady(input.messageId, previous, false);
    },
    finish() {
      for (const [messageId, state] of states) emitReady(messageId, state, true);
      states.clear();
    },
    reset() {
      for (const messageId of states.keys()) callbacks.invalidate(messageId);
      states.clear();
    },
  };
}

function toSpeakableText(text: string): string {
  let value = text.replace(/```[\s\S]*?```/g, ' ');
  const openFence = value.indexOf('```');
  if (openFence >= 0) value = value.slice(0, openFence);
  return value
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}(?:#{1,6}|[-*+]>?)\s+/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/[ \t]+/g, ' ');
}

function lastSpeakableBoundary(text: string): number {
  let boundary = 0;
  for (let index = 0; index < text.length; index += 1) {
    if ('，,。！？!?；;：:\n'.includes(text[index] ?? '')) boundary = index + 1;
  }
  return boundary;
}

function splitPhrases(text: string): string[] {
  return text.match(/[^，,。！？!?；;：:\n]*[，,。！？!?；;：:\n]+|[^，,。！？!?；;：:\n]+$/g) ?? [];
}

function cleanPhrase(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
