/* Maps canonical voice and run facts to the small state vocabulary consumed by character animation. */
import type { VoiceHostSnapshot } from '@megumi/product/host';

export type CharacterState =
  | 'idle'
  | 'listening'
  | 'recognizing'
  | 'thinking'
  | 'acting'
  | 'approval'
  | 'speaking'
  | 'error';

export interface CharacterStateFacts {
  readonly voiceStatus: VoiceHostSnapshot['status'];
  readonly activeTool?: boolean;
  readonly pendingApproval?: boolean;
  readonly playing?: boolean;
  readonly error?: boolean;
}

/** Priority prevents a lower-level voice phase from hiding a more actionable fact. */
export function resolveCharacterState(facts: CharacterStateFacts): CharacterState {
  if (facts.error) return 'error';
  if (facts.playing) return 'speaking';
  if (facts.pendingApproval) return 'approval';
  if (facts.activeTool) return 'acting';
  if (facts.voiceStatus === 'recognizing' || facts.voiceStatus === 'submitting') return 'recognizing';
  if (facts.voiceStatus === 'thinking') return 'thinking';
  if (facts.voiceStatus === 'speaking') return 'speaking';
  if (facts.voiceStatus === 'listening') return 'listening';
  if (facts.voiceStatus === 'error') return 'error';
  return 'idle';
}
