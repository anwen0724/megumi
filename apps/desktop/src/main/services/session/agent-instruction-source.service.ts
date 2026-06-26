// Desktop filesystem adapter for Coding Agent instruction source loading.
import { promises as fs } from 'node:fs';
import {
  AgentInstructionSourceService,
  AGENT_INSTRUCTION_SOURCE_CANDIDATES,
  AGENT_INSTRUCTION_SOURCE_FILE,
  AGENT_INSTRUCTION_SOURCE_HARD_CAP_BYTES,
  type AgentInstructionSourceServiceOptions,
  type LoadInstructionSourcesInput,
} from '@megumi/coding-agent/run/context/instructions';

export {
  AgentInstructionSourceService,
  AGENT_INSTRUCTION_SOURCE_CANDIDATES,
  AGENT_INSTRUCTION_SOURCE_FILE,
  AGENT_INSTRUCTION_SOURCE_HARD_CAP_BYTES,
};
export type {
  AgentInstructionSourceServiceOptions,
  LoadInstructionSourcesInput,
};

export function createDesktopAgentInstructionSourceService(
  options: Partial<AgentInstructionSourceServiceOptions> = {},
): AgentInstructionSourceService {
  return new AgentInstructionSourceService({
    readFile: options.readFile ?? ((filePath) => fs.readFile(filePath)),
    readDirectory: options.readDirectory ?? ((directoryPath) => fs.readdir(directoryPath)),
    ...(options.hardCapBytes ? { hardCapBytes: options.hardCapBytes } : {}),
  });
}
