"""Managed JSONL sidecar around the official MOSS-TTS-Nano ONNX runtime."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import sys
import threading
from pathlib import Path
from typing import Any

import numpy as np
from onnx_tts_runtime import OnnxTtsRuntime, _merge_audio_channels


_write_lock = threading.Lock()
_runtime_lock = threading.Lock()
_active_lock = threading.Lock()
_active_cancel: dict[str, threading.Event] = {}
_runtime: OnnxTtsRuntime | None = None
_runtime_model_path: Path | None = None


class SynthesisCancelled(Exception):
    pass


def emit(message: dict[str, Any]) -> None:
    with _write_lock:
        sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def prepare_upstream_layout(model_path: Path, cache_path: Path) -> Path:
    """Build the directory names expected by upstream using hard links in cache."""
    key = hashlib.sha256(str(model_path).encode("utf-8")).hexdigest()[:16]
    layout = cache_path / "moss-runtime-layout" / key
    mappings = (
        (model_path / "tts", layout / "MOSS-TTS-Nano-100M-ONNX"),
        (model_path / "audio-tokenizer", layout / "MOSS-Audio-Tokenizer-Nano-ONNX"),
    )
    for source, target in mappings:
        if not source.is_dir():
            raise FileNotFoundError(f"MOSS model directory is missing: {source}")
        target.mkdir(parents=True, exist_ok=True)
        for source_file in source.iterdir():
            if not source_file.is_file():
                continue
            target_file = target / source_file.name
            if target_file.exists() and target_file.stat().st_size == source_file.stat().st_size:
                continue
            target_file.unlink(missing_ok=True)
            try:
                os.link(source_file, target_file)
            except OSError:
                shutil.copy2(source_file, target_file)
    return layout


def get_runtime(model_path: Path, cache_path: Path) -> OnnxTtsRuntime:
    global _runtime, _runtime_model_path
    resolved = model_path.resolve()
    with _runtime_lock:
        if _runtime is not None and _runtime_model_path == resolved:
            return _runtime
        layout = prepare_upstream_layout(resolved, cache_path.resolve())
        _runtime = OnnxTtsRuntime(
            model_dir=layout,
            thread_count=max(1, min(8, os.cpu_count() or 4)),
            execution_provider="cpu",
            output_dir=cache_path / "moss-output",
        )
        _runtime_model_path = resolved
        return _runtime


def emit_pcm(synthesis_id: str, waveform: np.ndarray, sample_rate: int) -> None:
    samples = np.asarray(waveform, dtype="<f4").reshape(-1)
    if samples.size == 0:
        return
    emit({
        "type": "chunk",
        "synthesisId": synthesis_id,
        "sampleRate": int(sample_rate),
        "samplesBase64": base64.b64encode(samples.tobytes()).decode("ascii"),
    })


def synthesize_worker(message: dict[str, Any], cancel: threading.Event) -> None:
    synthesis_id = str(message["synthesisId"])
    try:
        model_path = Path(str(message["modelPath"]))
        cache_path = Path(str(message["cachePath"]))
        runtime = get_runtime(model_path, cache_path)
        prepared = runtime.prepare_synthesis_text(
            text=str(message["text"]),
            voice="",
            enable_wetext=False,
            enable_normalize_tts_text=True,
        )
        prompt_codes = runtime.resolve_prompt_audio_codes(
            voice=None,
            prompt_audio_path=Path(str(message["referenceAudioPath"])),
        )
        text_chunks = runtime.split_voice_clone_text(str(prepared["text"]), max_tokens=75)
        sample_rate = int(runtime.codec_meta["codec_config"]["sample_rate"])

        for text_chunk in text_chunks:
            if cancel.is_set():
                raise SynthesisCancelled()
            text_token_ids = runtime.encode_text(text_chunk)
            request_rows = runtime.build_voice_clone_request_rows(prompt_codes, text_token_ids)
            pending_frames: list[list[int]] = []
            runtime.codec_streaming_session.reset()

            def decode_pending(force: bool) -> None:
                if cancel.is_set():
                    raise SynthesisCancelled()
                if not pending_frames or (not force and len(pending_frames) < 8):
                    return
                frame_count = len(pending_frames) if force else min(8, len(pending_frames))
                frames = pending_frames[:frame_count]
                del pending_frames[:frame_count]
                decoded = runtime.codec_streaming_session.run_frames(frames)
                if decoded is None:
                    return
                audio, audio_length = decoded
                if audio_length <= 0:
                    return
                waveform = _merge_audio_channels([
                    audio[0, channel_index, :audio_length]
                    for channel_index in range(audio.shape[1])
                ])
                emit_pcm(synthesis_id, waveform, sample_rate)

            def on_frame(_frames: list[list[int]], _step: int, frame: list[int]) -> None:
                pending_frames.append(list(frame))
                decode_pending(False)

            try:
                runtime.generate_audio_frames(request_rows, on_frame=on_frame)
                decode_pending(True)
            finally:
                runtime.codec_streaming_session.reset()
        emit({"type": "complete", "synthesisId": synthesis_id})
    except SynthesisCancelled:
        emit({"type": "complete", "synthesisId": synthesis_id, "cancelled": True})
    except Exception as error:  # Process boundary: report stable data, not a traceback.
        emit({"type": "error", "synthesisId": synthesis_id, "message": str(error)})
    finally:
        with _active_lock:
            _active_cancel.pop(synthesis_id, None)


def handle(message: dict[str, Any]) -> bool:
    kind = message.get("type")
    if kind == "health":
        emit({"type": "ready"})
        return True
    if kind == "shutdown":
        with _active_lock:
            for cancel in _active_cancel.values():
                cancel.set()
        return False
    if kind == "cancel":
        with _active_lock:
            cancel = _active_cancel.get(str(message.get("synthesisId", "")))
        if cancel is not None:
            cancel.set()
        return True
    if kind == "synthesize":
        synthesis_id = str(message.get("synthesisId", ""))
        with _active_lock:
            if _active_cancel:
                emit({"type": "error", "synthesisId": synthesis_id, "message": "MOSS sidecar is busy."})
                return True
            cancel = threading.Event()
            _active_cancel[synthesis_id] = cancel
        threading.Thread(
            target=synthesize_worker,
            args=(message, cancel),
            name=f"moss-synthesis-{synthesis_id}",
            daemon=True,
        ).start()
    return True


def main() -> None:
    for raw_line in sys.stdin:
        try:
            message = json.loads(raw_line)
            if isinstance(message, dict) and not handle(message):
                break
        except Exception as error:
            emit({"type": "protocol_error", "message": str(error)})


if __name__ == "__main__":
    main()
