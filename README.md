# Megumi

Megumi is a local-first desktop AI agent tool for working with local code workspaces.

The first product direction is to bring a Claude Code / Codex-style agentic development workflow into a desktop app: choose a workspace, configure an AI provider, ask the agent to inspect context, plan work, request permission for actions, edit files, run commands, and stream progress in one visible session.

## Status

Megumi is in early development.

The current build includes the desktop shell, custom UI, provider settings, local configuration storage, project/workspace selection, session/run streaming, and foundations for approvals, artifacts, memory, and workspace context. Concrete built-in tools, file edits, command execution, and richer permission workflows are still under development.

## Features

Available today:

- Electron desktop app with custom window chrome
- Local provider configuration
- DeepSeek / OpenAI-compatible chat runtime
- Streaming assistant responses
- Project/workspace selection
- Session/run event timeline foundations
- Foundations for approvals, artifacts, memory, and workspace context
- Local `~/.megumi` runtime directory
- Local settings and provider credentials stored in `~/.megumi/settings.json`
- Warm and neutral desktop UI themes

Planned:

- Built-in workspace tools
- File editing and patch workflows
- Command execution with permission controls
- Richer approval and audit flows
- Deeper context and memory integration
- Claude Code-style agent workflows in a desktop interface

## Screenshots

Screenshots coming soon.

## Install Megumi

Windows users can download the latest unsigned installer from GitHub Releases.

1. Download `MegumiSetup.exe` from the latest release.
2. Run the installer.
3. Windows SmartScreen may show an "Unknown publisher" warning because the open-source build is unsigned.
4. Start Megumi and complete the first-run setup wizard.

Megumi creates its default home directory at:

```text
C:\Users\<you>\.megumi
```

Provider API keys entered during setup are intentionally written to `~/.megumi/settings.json` by the current settings design.

## Getting Started

Install dependencies:

```bash
npm install
```

Start the desktop app:

```bash
npm start
```

If native modules need to be rebuilt for Electron:

```bash
npm run start:fix-native
```

## Configuration

Megumi stores local runtime data under `~/.megumi` by default.

Provider API keys can be configured in the app settings or with environment variables:

```bash
DEEPSEEK_API_KEY=<your-deepseek-api-key>
OPENAI_API_KEY=<your-openai-api-key>
ANTHROPIC_API_KEY=<your-anthropic-api-key>
```

You can copy `.env.example` to `.env` for local development. Do not commit `.env`.

## Development

Run the test suite:

```bash
npm test
```

Type-check the project:

```bash
npx tsc --noEmit
```

Package the desktop app:

```bash
npm run package
```

Contributor and agent workflow notes live in `AGENTS.md`.

## Tech Stack

- Electron
- React
- TypeScript
- Zustand
- Tailwind CSS
- Vite
- SQLite / better-sqlite3
- Vitest

## License

License TBD.
