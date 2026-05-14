# Megumi

Megumi is a local-first desktop AI workspace companion.

It is designed for working with local projects and files through a calm desktop interface: choose a workspace, configure an AI provider, start a conversation, and stream model responses directly inside the app.

## Status

Megumi is in early development.

The current build includes the desktop shell, custom UI, provider settings, local configuration storage, and OpenAI-compatible streaming chat. Deeper agent capabilities such as tool execution, approvals, workspace context, memory, and artifacts are planned as the runtime matures.

## Features

Available today:

- Electron desktop app with custom window chrome
- Local provider configuration
- DeepSeek / OpenAI-compatible chat runtime
- Streaming assistant responses
- Local `~/.megumi` runtime directory
- Local secret storage through Electron safeStorage
- Warm and neutral desktop UI themes

Planned:

- Workspace-aware context
- Tool execution
- Approval flows
- Artifacts and task state
- Long-term memory
- Richer agent workflows

## Screenshots

Screenshots coming soon.

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
