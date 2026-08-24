/* Maps canonical voice and run facts to the small state vocabulary consumed by character animation. */
import type { VoiceHostSnapshot } from '@megumi/product-host/host';

export type CharacterState =
  | 'idle'
  | 'listening'
  | 'recognizing'
  | 'thinking'
  | 'acting'
  | 'approval'
  | 'error';

export interface CharacterStateFacts {
  // 'thinking' is derived from the active Agent Run in the renderer; the
  // Voice Session itself only produces the snapshot statuses below.
  readonly voiceStatus: VoiceHostSnapshot['status'] | 'thinking';
  readonly activeTool?: boolean;
  readonly pendingApproval?: boolean;
  readonly error?: boolean;
}

/** Priority prevents a lower-level voice phase from hiding a more actionable fact. */
export function resolveCharacterState(facts: CharacterStateFacts): CharacterState {
  if (facts.error) return 'error';
  if (facts.pendingApproval) return 'approval';
  if (facts.activeTool) return 'acting';
  if (facts.voiceStatus === 'recognizing') return 'recognizing';
  if (facts.voiceStatus === 'thinking') return 'thinking';
  if (facts.voiceStatus === 'listening') return 'listening';
  if (facts.voiceStatus === 'error') return 'error';
  return 'idle';
}
