/*
 * Defines the fixed Input Interpretation Contract and its ordered execution.
 * Each interpreter either leaves the input unhandled, accepts an adjusted
 * UserInput, or completes the submission; failures and cancellation use the
 * unified InputFailure channel, never a fake 'unhandled'.
 */

import type { InputContext, InputFailure, InputOperationOptions, UserInput } from "./input";

export type InputInterpretation<TResult> =
  | { readonly status: "unhandled" }
  | { readonly status: "accepted"; readonly input: UserInput }
  | { readonly status: "completed"; readonly result: TResult };

export interface InputInterpreter<TResult> {
  interpret(
    input: UserInput,
    context: InputContext,
    options?: InputOperationOptions,
  ): Promise<InputInterpretation<TResult>>;
}

/** Controlled cross-Package failure channel carrying an already classified InputFailure. */
export class InputInterpretationError extends Error {
  constructor(readonly failure: InputFailure) {
    super(failure.message);
    this.name = "InputInterpretationError";
  }
}

export function createInputInterpreterPipeline<TResult>(
  interpreters: readonly InputInterpreter<TResult>[],
): {
  run(
    input: UserInput,
    context: InputContext,
    options?: InputOperationOptions,
  ): Promise<InputInterpretation<TResult>>;
} {
  return {
    async run(input, context, options) {
      for (const interpreter of interpreters) {
        const result = await interpreter.interpret(input, context, options);
        if (result.status === "unhandled") continue;
        return result;
      }
      return { status: "unhandled" };
    },
  };
}
