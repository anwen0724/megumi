# @megumi/agent

Owns the platform-independent Agent Runtime for Megumi.

This package drives model steps, tool-call loops, runtime events, run lifecycle state, cancellation, and failure normalization through ports. It must stay free of Electron, renderer code, SQLite adapters, Coding Agent product session tree semantics, and concrete desktop host capabilities.
