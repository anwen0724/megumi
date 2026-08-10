"""Removes the upstream ONNX runtime's audio-loading-only PyTorch dependency."""

from __future__ import annotations

import sys
from pathlib import Path


IMPORTS_BEFORE = """import numpy as np
import sentencepiece as spm
import torch
import torchaudio
"""

IMPORTS_AFTER = """import numpy as np
import sentencepiece as spm
import soundfile as sf
from scipy.signal import resample_poly
"""

LOADER_BEFORE = """    def _load_reference_audio(self, reference_audio_path: str | Path) -> np.ndarray:
        waveform, sample_rate = torchaudio.load(str(Path(reference_audio_path).expanduser().resolve()))
        waveform = waveform.to(torch.float32)
        target_sample_rate = int(self.codec_meta["codec_config"]["sample_rate"])
        target_channels = int(self.codec_meta["codec_config"]["channels"])
        if sample_rate != target_sample_rate:
            waveform = torchaudio.functional.resample(waveform, sample_rate, target_sample_rate)
        current_channels = int(waveform.shape[0])
        if current_channels == target_channels:
            pass
        elif current_channels == 1 and target_channels > 1:
            waveform = waveform.repeat(target_channels, 1)
        elif current_channels > 1 and target_channels == 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        else:
            raise ValueError(f"Unsupported reference audio channel conversion: {current_channels} -> {target_channels}")
        return waveform.unsqueeze(0).detach().cpu().numpy().astype(np.float32, copy=False)
"""

LOADER_AFTER = """    def _load_reference_audio(self, reference_audio_path: str | Path) -> np.ndarray:
        samples, sample_rate = sf.read(
            str(Path(reference_audio_path).expanduser().resolve()),
            dtype="float32",
            always_2d=True,
        )
        waveform = np.asarray(samples.T, dtype=np.float32)
        target_sample_rate = int(self.codec_meta["codec_config"]["sample_rate"])
        target_channels = int(self.codec_meta["codec_config"]["channels"])
        if sample_rate != target_sample_rate:
            divisor = int(np.gcd(sample_rate, target_sample_rate))
            waveform = resample_poly(
                waveform,
                target_sample_rate // divisor,
                sample_rate // divisor,
                axis=1,
            ).astype(np.float32, copy=False)
        current_channels = int(waveform.shape[0])
        if current_channels == target_channels:
            pass
        elif current_channels == 1 and target_channels > 1:
            waveform = np.repeat(waveform, target_channels, axis=0)
        elif current_channels > 1 and target_channels == 1:
            waveform = waveform.mean(axis=0, keepdims=True, dtype=np.float32)
        else:
            raise ValueError(f"Unsupported reference audio channel conversion: {current_channels} -> {target_channels}")
        return waveform[np.newaxis, ...].astype(np.float32, copy=False)
"""


def main() -> None:
    runtime_path = Path(sys.argv[1]).resolve()
    source = runtime_path.read_text(encoding="utf-8")
    if IMPORTS_AFTER in source and LOADER_AFTER in source:
        return
    if IMPORTS_BEFORE not in source or LOADER_BEFORE not in source:
        raise RuntimeError("Pinned MOSS ONNX runtime changed; refusing to apply an unverified patch.")
    runtime_path.write_text(
        source.replace(IMPORTS_BEFORE, IMPORTS_AFTER).replace(LOADER_BEFORE, LOADER_AFTER),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
