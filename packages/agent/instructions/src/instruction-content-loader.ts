/* Loads the fixed common and execution-profile instruction documents from UTF-8 content files. */
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  InstructionProfile,
  SystemInstructionDocument,
} from './instructions';

const PROFILE_FILES: Record<InstructionProfile, string> = {
  conversation: 'conversation.md',
  daily_discovery: 'daily-discovery.md',
};

export interface LoadSystemInstructionDocumentsRequest {
  readonly contentRoot: string;
  readonly profile: InstructionProfile;
}

export async function loadSystemInstructionDocuments(
  request: LoadSystemInstructionDocumentsRequest,
): Promise<readonly SystemInstructionDocument[]> {
  const commonPath = path.resolve(request.contentRoot, 'common.md');
  const profilePath = path.resolve(request.contentRoot, PROFILE_FILES[request.profile]);
  const [common, profile] = await Promise.all([
    fs.readFile(commonPath, 'utf8'),
    fs.readFile(profilePath, 'utf8'),
  ]);
  return [
    {
      instructionId: 'megumi.common',
      sourcePath: commonPath,
      content: requireContent(commonPath, common),
    },
    {
      instructionId: `megumi.${PROFILE_FILES[request.profile].replace(/\.md$/, '')}`,
      sourcePath: profilePath,
      content: requireContent(profilePath, profile),
    },
  ];
}

function requireContent(sourcePath: string, content: string): string {
  const normalized = content.trim();
  if (!normalized) throw new Error(`System instruction document is empty: ${sourcePath}`);
  return normalized;
}
