# @megumi/coding-agent

Owns Megumi Coding Agent product-core behavior.

This package contains the complete platform-independent Coding Agent product core. It owns input processing, explicit command entrypoints, session, context, agent run orchestration, tool execution system, permissions, memory, artifacts, workspace, settings, persistence, local adapters, and host interface composition.

It may depend on `@megumi/ai` and module-owned contracts. The run orchestration lifecycle lives in `packages/coding-agent/agent-run`; there is no target top-level `agent-loop` or generic `state` module. Runtime event publishing remains a separate module concern. Coding Agent product core must not depend on Electron, desktop IPC, renderer code, BrowserWindow, safeStorage, desktop services, or desktop projections. Desktop, CLI, Web, and test runners should enter the product through `host-interface` instead of importing internal product modules directly.
