# @megumi/coding-agent

Owns Megumi Coding Agent product-core behavior.

This package contains the complete platform-independent Coding Agent product runtime. It owns input sensing, explicit command entrypoints, session, run, run context, tool execution system, memory, artifact, workspace, settings, persistence, local adapters, and product runtime composition.

It may depend on `@megumi/agent`, `@megumi/ai`, and shared contracts. It must not depend on Electron, desktop IPC, renderer code, BrowserWindow, safeStorage, desktop services, or desktop projections. Desktop, CLI, Web, and test runners should enter the product through `product-runtime` instead of importing internal product modules directly.
