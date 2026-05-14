# @megumi/ai

Owns provider adapters, model metadata, prompt/message mapping, and OpenAI-compatible streaming normalization for Megumi.

This package receives resolved runtime provider configuration from callers. It does not read user settings, decrypt secrets, access SQLite repositories, or call Electron APIs.
