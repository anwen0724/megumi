# Config

This directory is for repository-level configuration templates and shared config inputs.

Use it for:

- shared config templates
- tool config fragments reused by scripts
- example config files that should not live beside runtime code

Keep root-level build entry configs in the root when the tool expects them there, such as Vite, Vitest, Electron Forge, TypeScript, and PostCSS config files.

Runtime app configuration belongs with the app or package that owns it.
