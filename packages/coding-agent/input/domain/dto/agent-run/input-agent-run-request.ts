/* Defines the Agent Run request accepted by the Input owner. */
import type { RawUserInput } from '../../model/user-input';

export type ProcessUserInputRequest = {
  user_input: RawUserInput;
};

export type { ProcessUserInputResult } from './input-agent-run-response';
