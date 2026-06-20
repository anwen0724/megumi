// Guards the migrated renderer so it remains UI-only and src-owned.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
const uiRoot = path.join(repoRoot, 'src/ui');
const appRoot = path.join(repoRoot, 'src/app');

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      return listSourceFiles(absolute);
    }
    return /\.(ts|tsx)$/.test(entry) ? [absolute] : [];
  });
}

function readUiSource(): string {
  return listSourceFiles(uiRoot)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

function readUiImportSpecifiers(): string[] {
  const importPattern = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;
  return [...readUiSource().matchAll(importPattern)].map((match) => match[1]);
}

describe('src/ui renderer contract cleanup boundary', () => {
  it('does not import old package shared contracts', () => {
    expect(readUiSource()).not.toContain('@megumi/shared');
  });

  it('does not import owner modules or desktop main implementation directly', () => {
    const specifiers = readUiImportSpecifiers();

    for (const forbidden of [
      '../agent',
      '../ai',
      '../app',
      '../command',
      '../context',
      '../database',
      '../desktop',
      '../input',
      '../permission',
      '../session',
      '../tools',
      '../workspace',
      'src/agent',
      'src/ai',
      'src/app',
      'src/command',
      'src/context',
      'src/database',
      'src/desktop',
      'src/input',
      'src/permission',
      'src/session',
      'src/tools',
      'src/workspace',
      'electron',
      'node:fs',
      'node:child_process',
      'child_process',
    ]) {
      expect(specifiers.some((specifier) => specifier === forbidden || specifier.startsWith(`${forbidden}/`))).toBe(false);
    }
  });

  it('keeps window.megumi as the renderer integration point', () => {
    const source = readUiSource();

    expect(source).toContain('window.megumi');
    expect(source).toContain('chatStream');
    expect(source).toContain('runtime');
    expect(source).toContain('session.message.send');
  });

  it('keeps chat stream UI on renderer eventType protocol instead of app/runtime events', () => {
    const chatStreamSource = listSourceFiles(path.join(uiRoot, 'features/chat-stream'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    expect(chatStreamSource).not.toContain('AppEvent');
    expect(chatStreamSource).not.toContain('AgentRuntimeEvent');
    expect(chatStreamSource).not.toContain('RendererChatStreamEventDto');
    expect(chatStreamSource).toContain('eventType');
  });

  it('keeps app out of the live desktop event forwarding path', () => {
    const appSource = listSourceFiles(appRoot)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const appApiSource = readFileSync(path.join(appRoot, 'app-api.ts'), 'utf8');
    const appAdapterSource = readFileSync(path.join(appRoot, 'create-app-api.ts'), 'utf8');
    const chatForwarderSource = readFileSync(path.join(repoRoot, 'src/desktop/ipc/events/chat-stream-event-forwarder.ts'), 'utf8');
    const runtimeForwarderSource = readFileSync(path.join(repoRoot, 'src/desktop/ipc/events/runtime-event-forwarder.ts'), 'utf8');

    expect(appSource).not.toMatch(/\bAppEvent\b/);
    expect(appSource).not.toContain('mapAgentRuntimeEventToAppEvent');
    expect(appApiSource).not.toContain('subscribe(');
    expect(appAdapterSource).not.toContain('subscribe(');
    expect(chatForwarderSource).not.toContain('AppApi');
    expect(runtimeForwarderSource).not.toContain('AppApi');
    expect(chatForwarderSource).toContain('AgentRuntimePort');
    expect(runtimeForwarderSource).toContain('AgentRuntimePort');
  });
});
