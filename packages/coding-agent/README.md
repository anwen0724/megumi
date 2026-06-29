# @megumi/coding-agent

Owns Megumi Coding Agent product-core behavior.

This package contains the complete platform-independent Coding Agent product runtime. It owns input sensing, explicit command entrypoints, session, context, agent loop, tool execution system, permissions, memory, artifacts, workspace, settings, persistence, local adapters, and product runtime composition.

It may depend on `@megumi/ai` and shared contracts. The model/tool loop lives in `packages/coding-agent/agent-loop`, model-call adaptation lives in `agent-loop/model-call`, tool-call orchestration lives in `agent-loop/tool-call`, state lifecycle lives in `state`, and runtime event ownership lives in `events`. The remaining `run` directory is a transitional implementation shell being dismantled, not the target architecture. It must not depend on Electron, desktop IPC, renderer code, BrowserWindow, safeStorage, desktop services, or desktop projections. Desktop, CLI, Web, and test runners should enter the product through `product-runtime` instead of importing internal product modules directly.
