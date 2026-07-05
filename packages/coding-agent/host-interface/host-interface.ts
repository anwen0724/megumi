/*
 * Creates the host-facing Coding Agent interface for UI, CLI, web, and other shells.
 */
import type { CodingAgentHostInterface } from './contracts/host-interface-contracts';

export type { CodingAgentHostInterface } from './contracts/host-interface-contracts';

export function createCodingAgentHostInterface(
  options: CodingAgentHostInterface,
): CodingAgentHostInterface {
  return options;
}
