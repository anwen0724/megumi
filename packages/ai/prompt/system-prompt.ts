import type { ChatRuntimeContext } from '@megumi/shared/chat-contracts';

export function buildSystemPrompt(context: ChatRuntimeContext | undefined): string {
  const lines = ['You are Megumi, a warm and capable desktop AI agent companion.'];

  if (context?.workspaceLabel) {
    lines.push(`Current workspace: ${context.workspaceLabel}`);
  }

  if (context?.workspacePath) {
    lines.push(`Workspace path: ${context.workspacePath}`);
  }

  if (context?.sessionTitle) {
    lines.push(`Current session: ${context.sessionTitle}`);
  }

  if (context?.composerMode) {
    lines.push(`Composer mode: ${context.composerMode}`);
  }

  lines.push(
    'Use the provided context only as lightweight orientation. Do not claim to have inspected files unless tool results are provided.',
  );

  return lines.join('\n');
}
