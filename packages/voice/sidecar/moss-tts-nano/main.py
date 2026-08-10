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
from onnx_tts_runtime import OnnxTtsRuntime


_write_lock = threading.Lock()
_runtime_lock = threading.Lock()
_active_lock = threading.Lock()
_active_cancel: dict[str, threading.Event] = {}
_runtime: OnnxTtsRuntime | None = None
_runtime_model_path: Path | None = None
_prompt_codes: dict[tuple[Any, ...], Any] = {}


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
        _prompt_codes.clear()
        return _runtime


def get_prompt_audio_codes(
    runtime: OnnxTtsRuntime,
    *,
    voice_id: str | None = None,
    reference_audio_path: Path | None = None,
) -> Any:
    """Resolve the selected voice once and retain it for this sidecar lifetime."""
    if voice_id:
        key = ("built_in", voice_id)
        resolved: Path | None = None
    elif reference_audio_path is not None:
        resolved = reference_audio_path.resolve()
        stat = resolved.stat()
        key = ("reference_audio", str(resolved), stat.st_mtime_ns, stat.st_size)
    else:
        raise ValueError("MOSS voice source is missing.")
    cached = _prompt_codes.get(key)
    if cached is not None:
        return cached
    codes = runtime.resolve_prompt_audio_codes(
        voice=voice_id,
        prompt_audio_path=resolved,
    )
    _prompt_codes.clear()
    _prompt_codes[key] = codes
    return codes


def parse_voice_source(message: dict[str, Any]) -> tuple[str | None, Path | None]:
    voice = message.get("voice")
    if not isinstance(voice, dict):
        raise ValueError("MOSS voice source is invalid.")
    if voice.get("kind") == "built_in" and isinstance(voice.get("voiceId"), str):
        return str(voice["voiceId"]), None
    if voice.get("kind") == "reference_audio" and isinstance(voice.get("referenceAudioPath"), str):
        return None, Path(str(voice["referenceAudioPath"]))
    raise ValueError("MOSS voice source is invalid.")


def prepare_worker(message: dict[str, Any], cancel: threading.Event) -> None:
    preparation_id = str(message["preparationId"])
    try:
        runtime = get_runtime(
            Path(str(message["modelPath"])),
            Path(str(message["cachePath"])),
        )
        if cancel.is_set():
            raise SynthesisCancelled()
        voice_id, reference_audio_path = parse_voice_source(message)
        get_prompt_audio_codes(
            runtime,
            voice_id=voice_id,
            reference_audio_path=reference_audio_path,
        )
        if cancel.is_set():
            raise SynthesisCancelled()
        with _active_lock:
            _active_cancel.pop(preparation_id, None)
        emit({"type": "prepared", "preparationId": preparation_id})
    except SynthesisCancelled:
        emit({
            "type": "prepare_error",
            "preparationId": preparation_id,
            "message": "MOSS preparation was cancelled.",
        })
    except Exception as error:  # Process boundary: report stable data, not a traceback.
        emit({"type": "prepare_error", "preparationId": preparation_id, "message": str(error)})
    finally:
        with _active_lock:
            _active_cancel.pop(preparation_id, None)


def emit_pcm(synthesis_id: str, waveform: np.ndarray, sample_rate: int) -> None:
    audio = np.asarray(waveform, dtype=np.float32)
    if audio.ndim <= 1:
        samples = audio.reshape(-1)
    elif audio.shape[1] == 1:
        samples = audio[:, 0]
    else:
        # The public Voice PCM seam is mono. Averaging channels preserves the
        # frame count; flattening would double duration and lower pitch.
        samples = np.mean(audio, axis=1, dtype=np.float32)
    samples = np.asarray(samples, dtype="<f4")
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
        # The upstream synthesize() entrypoint resets sampling for every request.
        # This sidecar drives its streaming callbacks directly, so mirror that
        # behavior or prior previews consume RNG state and later speech may run
        # to max frames as unintelligible audio.
        runtime.rng = np.random.default_rng(1234)
        runtime.manifest["generation_defaults"]["sample_mode"] = "fixed"
        runtime.manifest["generation_defaults"]["do_sample"] = True
        voice_id, reference_audio_path = parse_voice_source(message)
        prepared = runtime.prepare_synthesis_text(
            text=str(message["text"]),
            voice=voice_id or "",
            enable_wetext=False,
            enable_normalize_tts_text=True,
        )
        prompt_codes = get_prompt_audio_codes(
            runtime,
            voice_id=voice_id,
            reference_audio_path=reference_audio_path,
        )
        text_chunks = runtime.split_voice_clone_text(str(prepared["text"]), max_tokens=75)
        sample_rate = int(runtime.codec_meta["codec_config"]["sample_rate"])

        for text_chunk in text_chunks:
            if cancel.is_set():
                raise SynthesisCancelled()
            result = runtime.synthesize_single_chunk(
                text=text_chunk,
                prompt_audio_codes=prompt_codes,
                streaming=True,
            )
            waveform = np.asarray(result["waveform"], dtype=np.float32)
            frames_per_chunk = max(1, sample_rate // 4)
            for start in range(0, waveform.shape[0], frames_per_chunk):
                if cancel.is_set():
                    raise SynthesisCancelled()
                emit_pcm(synthesis_id, waveform[start:start + frames_per_chunk], sample_rate)
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
        emit({"type": "ready", "protocolVersion": 2})
        return True
    if kind == "shutdown":
        with _active_lock:
            for cancel in _active_cancel.values():
                cancel.set()
        return False
    if kind == "cancel":
        with _active_lock:
            operation_id = str(message.get("synthesisId") or message.get("preparationId") or "")
            cancel = _active_cancel.get(operation_id)
        if cancel is not None:
            cancel.set()
        return True
    if kind == "prepare":
        preparation_id = str(message.get("preparationId", ""))
        with _active_lock:
            if _active_cancel:
                emit({
                    "type": "prepare_error",
                    "preparationId": preparation_id,
                    "message": "MOSS sidecar is busy.",
                })
                return True
            cancel = threading.Event()
            _active_cancel[preparation_id] = cancel
        threading.Thread(
            target=prepare_worker,
            args=(message, cancel),
            name=f"moss-preparation-{preparation_id}",
            daemon=True,
        ).start()
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
