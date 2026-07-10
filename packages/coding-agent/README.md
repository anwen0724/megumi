# @megumi/coding-agent

Owns Megumi agent-core behavior.

This package contains the platform-independent agent core. It owns input processing, explicit command entrypoints, session, context, agent run orchestration, tool execution system, permissions, memory, artifacts, workspace, settings, persistence, local adapters, and the current host interface composition.

It may depend on `@megumi/ai`, `@megumi/home`, and module-owned contracts. The run orchestration lifecycle lives in `packages/coding-agent/agent-run`; there is no target top-level `agent-loop` or generic `state` module. Runtime event publishing remains a separate module concern. The agent core must not depend on Electron, desktop IPC, renderer code, BrowserWindow, safeStorage, desktop services, or desktop projections. Desktop, CLI, Web, and test runners should enter through product host interfaces instead of importing internal agent modules directly. The current `host-interface` location under this package is transitional and should be revisited as product-level package boundaries mature.
