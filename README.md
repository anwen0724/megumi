# Megumi

Megumi 是一个温暖、柔和的 AI Agent 桌面伙伴项目。

项目目标是成为类似 Codex、Claude Code、Claude Desktop 这一类本地工作区 Agent 应用：用户可以在桌面应用中选择本地 workspace，和 AI 进行会话，流式查看模型输出，并逐步扩展到工具执行、审批、上下文管理、长期记忆、文件管理、网页研究、命令执行和文档写作等能力。

> 当前仓库仍处于早期开发阶段。产品方向不代表所有能力都已经实现，当前实现状态以 `docs/product/` 中的编号规范、验收文档和代码为准。

## 技术栈

- Electron Main / Preload / Renderer
- React 19
- TypeScript 5.7
- Zustand 5
- Tailwind CSS 4
- Vite 5
- Electron Forge
- SQLite / better-sqlite3
- Vitest 4

## 快速开始

安装依赖：

```bash
npm install
```

启动桌面应用：

```bash
npm start
```

如果 native module ABI 不匹配，使用：

```bash
npm run start:fix-native
```

运行测试：

```bash
npm test
```

类型检查：

```bash
npx tsc --noEmit
```

打包：

```bash
npm run package
```

## 配置

Megumi 默认使用用户目录下的 `~/.megumi` 作为本地运行目录，用于保存配置、密钥引用、本地数据库和日志等运行数据。

Provider API key 可以通过以下方式配置：

- 应用内 Settings -> Models
- 环境变量，例如 `DEEPSEEK_API_KEY`
- `~/.megumi/config.json`

可以复制 `.env.example` 为 `.env` 作为本地开发环境变量文件。不要提交 `.env`。

## 项目结构

```text
megumi/
|-- apps/
|   `-- desktop/                  # Electron desktop app
|-- packages/
|   |-- core/                     # Runtime orchestration contracts and core flows
|   |-- ai/                       # Provider adapters and model streaming
|   |-- tools/                    # Future tool contracts and execution
|   |-- memory/                   # Future memory and context logic
|   |-- db/                       # SQLite connection, migrations, repositories
|   |-- security/                 # Security, redaction, secret and sandbox policies
|   `-- shared/                   # Shared contracts, schemas and IPC channels
|-- tests/                        # Mirrors apps/ and packages/
|-- docs/                         # Product, architecture and operation docs
|-- scripts/
|-- config/
`-- data/                         # Local runtime data, gitignored
```

详细规则见：

- `AGENTS.md`
- `docs/AGENT_CONTEXT.md`
- `docs/product/README.md`
- `docs/architecture/package-structure.md`
- `docs/architecture/directory-structure.md`

## 开发说明

本项目的长期 source of truth 放在 `docs/product/` 和 `docs/architecture/` 中。开始修改产品行为、架构或 runtime foundation 前，请先阅读 `AGENTS.md` 和 `docs/AGENT_CONTEXT.md`。
