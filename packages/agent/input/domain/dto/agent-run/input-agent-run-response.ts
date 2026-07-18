/* Defines the processed Input result returned to Agent Run. */
import type { InputFailure, ParsedUserInput } from '../../model/user-input';

export type ProcessUserInputResult =
  | { status: 'ok'; parsed_user_input: ParsedUserInput }
  | { status: 'failed'; failure: InputFailure };
