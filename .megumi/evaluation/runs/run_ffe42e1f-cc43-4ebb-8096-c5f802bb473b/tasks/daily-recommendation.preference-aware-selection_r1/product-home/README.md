# Megumi Home

This directory stores Megumi runtime configuration and local agent data.

Safe to edit:

- `settings.json` for app preferences, provider configuration, model defaults, permissions, and intentional plaintext API keys.
- `language` and `setup` fields in `settings.json` store the first-run setup status and language preference.
- `skills/` for user-installed skills.

Managed by Megumi:

- `settings.schema.json` for editor validation.
- `version.json` for home directory metadata.
- `skills/.system/` for Megumi-provided system skills.
- `sqlite/` for structured runtime state.
- `logs/` for application logs.
- `cache/` for regenerable cache data.
- `tmp/` for temporary files.
- `attachments/` for Session-owned managed image copies.
- `voice/` for local speech models, Voice Profiles, cache, and temporary audio.

Credential priority:

1. Plaintext `api_key` in `settings.json` when intentionally provided.
2. Environment variable configured by `api_key_env`.

Set `MEGUMI_HOME` to use a different Megumi Home directory.
