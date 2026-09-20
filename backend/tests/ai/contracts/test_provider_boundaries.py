"""Prove configuration operations work with network access forbidden."""

import os
import subprocess
import sys
import textwrap
from pathlib import Path


def test_fresh_import_and_configuration_never_attempt_network():
    script = textwrap.dedent("""
        import asyncio
        import sys

        # Windows initializes a loopback socket pair for the event loop itself.
        # Construct it before the guard; all AI imports and operations stay guarded.
        loop = asyncio.new_event_loop()
        attempts = []
        def forbid_network(event, args):
            if event.startswith(("socket.connect", "socket.getaddrinfo",
                                 "socket.gethostby", "socket.sendto",
                                 "http.client.connect")):
                attempts.append(event)
                raise AssertionError("Network access is forbidden")

        sys.addaudithook(forbid_network)

        from dataclasses import replace
        from app.ai.models import create_models
        from app.ai.auth.memory import InMemoryCredentialStore
        from app.ai.auth.types import ApiKeyCredential
        from app.ai.providers.deepseek import deepseek_provider
        from app.ai.providers.openai import openai_provider

        async def check():
            credentials = InMemoryCredentialStore()
            await credentials.set("deepseek", ApiKeyCredential("fake-stored-key"))
            models = create_models(
                [deepseek_provider(), openai_provider()], credentials=credentials
            )
            original = models.get_models("deepseek")[0]
            custom = replace(original, id="private-model")
            models.set_provider(deepseek_provider(
                models=[custom], base_url="http://localhost:9999/v1"
            ))
            assert models.get_model("deepseek", "private-model") == custom
            assert models.get_model("unknown", "missing") is None
            assert len(await models.get_available_models()) >= 2
            resolved = await models.resolve_auth(custom)
            assert resolved.base_url == "http://localhost:9999/v1"
            assert resolved.source == "stored"

        try:
            loop.run_until_complete(check())
        finally:
            loop.close()
        assert attempts == [], attempts
    """)
    env = dict(os.environ, DEEPSEEK_API_KEY="", OPENAI_API_KEY="fake-openai-env-key")
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[3],
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stdout + result.stderr
