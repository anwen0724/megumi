// Defines failure lifecycle boundaries shared by turn and service-level run code.
import type { RuntimeError } from '@megumi/shared/runtime';

export interface RunFailureInput {
  runId: string;
  stepId?: string;
  error: RuntimeError;
  failedAt: string;
}
