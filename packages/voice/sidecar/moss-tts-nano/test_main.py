"""Regression tests for the MOSS sidecar's host-facing PCM contract."""

import base64
import importlib.util
from pathlib import Path
import unittest

import numpy as np


def load_sidecar_module():
    main_path = Path(__file__).with_name("main.py")
    spec = importlib.util.spec_from_file_location("megumi_moss_sidecar", main_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class EmitPcmTests(unittest.TestCase):
    def test_downmixes_stereo_frames_before_declaring_mono(self):
        module = load_sidecar_module()
        messages = []
        module.emit = messages.append
        stereo_frames = np.asarray([
            [0.1, 0.3],
            [0.2, 0.4],
            [0.3, 0.5],
        ], dtype=np.float32)

        module.emit_pcm("test", stereo_frames, 48_000)

        samples = np.frombuffer(
            base64.b64decode(messages[0]["samplesBase64"]),
            dtype="<f4",
        )
        np.testing.assert_allclose(samples, [0.2, 0.3, 0.4])
        self.assertEqual(samples.size, stereo_frames.shape[0])


class VoiceSourceTests(unittest.TestCase):
    def test_resolves_built_in_voice_without_reference_audio(self):
        module = load_sidecar_module()
        module._prompt_codes.clear()

        class Runtime:
            def __init__(self):
                self.calls = []

            def resolve_prompt_audio_codes(self, **kwargs):
                self.calls.append(kwargs)
                return [1, 2, 3]

        runtime = Runtime()
        first = module.get_prompt_audio_codes(runtime, voice_id="Xiaoyu")
        second = module.get_prompt_audio_codes(runtime, voice_id="Xiaoyu")

        self.assertIs(first, second)
        self.assertEqual(runtime.calls, [{"voice": "Xiaoyu", "prompt_audio_path": None}])

    def test_health_reports_the_protocol_version(self):
        module = load_sidecar_module()
        messages = []
        module.emit = messages.append

        self.assertTrue(module.handle({"type": "health"}))
        self.assertEqual(messages, [{"type": "ready", "protocolVersion": 2}])


if __name__ == "__main__":
    unittest.main()
