import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';
import { resolveSafePath } from '@megumi/coding-agent/adapters/local/security/sandbox-policy';

export async function readFile(workspaceRoot: string, filePath: string): Promise<string> {
  return fs.readFile(resolveSafePath(workspaceRoot, filePath), 'utf-8');
}

export async function writeFile(workspaceRoot: string, filePath: string, content: string): Promise<void> {
  const resolved = resolveSafePath(workspaceRoot, filePath);
  await fs.ensureDir(path.dirname(resolved));
  return fs.writeFile(resolved, content, 'utf-8');
}

// Replaces the first occurrence of oldStr with newStr.
// Returns false if oldStr is not found, true on success.
export async function editFile(
  workspaceRoot: string,
  filePath: string,
  oldStr: string,
  newStr: string,
): Promise<boolean> {
  const resolved = resolveSafePath(workspaceRoot, filePath);
  const content = await fs.readFile(resolved, 'utf-8');
  const index = content.indexOf(oldStr);
  if (index === -1) return false;
  const updated = content.replace(oldStr, newStr);
  await fs.writeFile(resolved, updated, 'utf-8');
  return true;
}

export async function listFiles(workspaceRoot: string, dirPath: string): Promise<string[]> {
  const resolved = resolveSafePath(workspaceRoot, dirPath);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  return entries.map((e) => `${e.isDirectory() ? '/' : ''}${e.name}`);
}

class CommandError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

export function runCommand(
  command: string,
  cwd?: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      timeout: 30000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        reject(new CommandError(`Command exited with code ${code}`, stderr));
      }
    });
  });
}
