# @megumi/coding-agent

Owns Megumi agent-core behavior.

This package contains the platform-independent agent core. It owns input processing, explicit command entrypoints, session, context, agent run orchestration, tool execution system, permissions, memory, artifacts, workspace, settings, persistence, and local adapters.

It may depend on `@megumi/ai`, prompt resources, and module-owned interfaces. The run orchestration lifecycle lives in `packages/coding-agent/agent-run`; there is no target top-level `agent-loop` or generic `state` module. Runtime event publishing remains a separate module concern. The agent core must not depend on `@megumi/product`, Electron, desktop IPC, renderer code, BrowserWindow, safeStorage, desktop modules, or desktop projections. Desktop, CLI, Web, and test runners enter through the Product Host Interface instead of importing internal agent modules directly.
