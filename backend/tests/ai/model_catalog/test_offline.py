"""Real provider loading and development checks work without network or credentials."""

import os
import subprocess
import sys


def test_runtime_import_and_offline_commands_work_from_another_directory(tmp_path):
    script = """
import sys
attempts = []
def forbid(event, args):
    if event.startswith(("socket.connect", "socket.getaddrinfo", "socket.gethostby",
                         "socket.sendto", "http.client.connect")):
        attempts.append(event)
        raise AssertionError("No network allowed")
sys.addaudithook(forbid)
from app.ai import create_models, openai_provider, deepseek_provider
assert not any(name.startswith("app.ai.scripts") for name in sys.modules)
models = create_models([openai_provider(), deepseek_provider()])
assert models.get_models("openai") and models.get_models("deepseek")
from app.ai.scripts.generate_models import main
assert main(["generate"]) == 0
assert main(["check"]) == 0
assert not attempts
"""
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in {"OPENAI_API_KEY", "DEEPSEEK_API_KEY"}
    }
    env["PYTHONUTF8"] = "1"
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        encoding="utf-8",
        timeout=15,
    )
    assert result.returncode == 0, result.stdout + result.stderr
