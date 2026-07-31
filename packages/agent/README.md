# @megumi/agent

Owns Megumi agent-core behavior.

This package contains the platform-independent Agent capabilities. It owns input processing, explicit command entrypoints, Session, Context, Tools, Permissions, Memory, Artifacts, Workspace, persistence, projections, and local adapters.

Run orchestration belongs exclusively to `@megumi/engine`; this package must not contain a second execution loop or compatibility facade. It may depend on `@megumi/ai`, prompt resources, and module-owned interfaces. Runtime Event contracts remain owned by Events. Agent capabilities must not depend on `@megumi/product`, Electron, desktop IPC, renderer code, BrowserWindow, safeStorage, desktop modules, or desktop projections. Desktop, CLI, Web, and test runners enter through the Product Host Interface instead of importing internal Agent modules directly.
