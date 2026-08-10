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


if __name__ == "__main__":
    unittest.main()
