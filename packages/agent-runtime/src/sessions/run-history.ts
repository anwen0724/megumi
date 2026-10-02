/* Owns isolated, transient message history for one run without creating a persisted chat. */
import type { Message } from '@megumi/ai';

/** Keeps run-local messages inside sessions; loop inputs and public reads are detached snapshots. */
export function createRunHistory(initial: readonly Message[] = []) {
  let messages = structuredClone([...initial]);
  return {
    /** Reads the complete history without exposing mutable stored messages. */
    read(): Message[] { return structuredClone(messages); },
    /** Records a complete message after its processing has finished. */
    append(message: Message): void { messages.push(structuredClone(message)); },
    /** Replaces history only when the owning run controller is idle. */
    replace(next: readonly Message[]): void { messages = structuredClone([...next]); },
  };
}
