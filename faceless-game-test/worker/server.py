import json
import os
import re
import shutil
import subprocess
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import yaml

JOBS = {}
JOBS_LOCK = threading.Lock()
ANALYSIS_JOBS = {}
ANALYSIS_JOBS_LOCK = threading.Lock()
DEFAULT_TIMEOUT_SECONDS = 20 * 60
DEFAULT_LOG_TAIL_LINES = 200
MAX_STATUS_MESSAGE_CHARS = 220


class _SafeLoaderWithTuple(yaml.SafeLoader):
    pass


def _tuple_constructor(loader, node):
    return loader.construct_sequence(node)


_SafeLoaderWithTuple.add_constructor("tag:yaml.org,2002:python/tuple", _tuple_constructor)


def _parse_positive_int(raw_value, fallback):
    try:
        parsed = int(raw_value)
        if parsed > 0:
            return parsed
    except Exception:
        pass
    return fallback


def _parse_number(raw_value, fallback):
    try:
        parsed = float(raw_value)
        if parsed == parsed and parsed not in (float("inf"), float("-inf")):
            return parsed
    except Exception:
        pass
    return fallback


def _parse_nonempty_string(raw_value, fallback):
    text = str(raw_value or "").strip()
    return text if text else fallback


def _is_truthy(raw_value):
    return str(raw_value or "").strip().lower() in ("1", "true", "yes", "on")


def _json_response(handler, code, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _read_json(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    raw = handler.rfile.read(length)
    return json.loads(raw.decode("utf-8") if raw else "{}")


def _sanitize_label(value):
    return re.sub(r"[^a-z0-9_-]+", "", value.lower())[:60]


def _sanitize_id(value):
    return re.sub(r"[^a-z0-9-]+", "-", str(value).lower()).strip("-")[:80]


def _load_saved_entry(storage_dir: Path, entry_id: str):
    json_path = storage_dir / "json" / f"{entry_id}.json"
    if not json_path.exists():
        return None, None
    content = json.loads(json_path.read_text(encoding="utf-8"))
    return content, json_path


def _job_log_path(storage_dir: Path, entry_id: str):
    safe_entry_id = _sanitize_id(entry_id)
    if not safe_entry_id:
        return None
    return storage_dir / "separated" / safe_entry_id / "separation.log"


def _analysis_log_path(storage_dir: Path, entry_id: str):
    safe_entry_id = _sanitize_id(entry_id)
    if not safe_entry_id:
        return None
    return storage_dir / "analysis" / safe_entry_id / "analysis.log"


def _analysis_result_path(storage_dir: Path, entry_id: str):
    safe_entry_id = _sanitize_id(entry_id)
    if not safe_entry_id:
        return None
    return storage_dir / "analysis" / f"{safe_entry_id}.json"


def _append_log_line(log_path: Path, level: str, message: str):
    log_path.parent.mkdir(parents=True, exist_ok=True)
    timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    line = f"{timestamp} [{level}] {message}"
    print(line, flush=True)
    with log_path.open("a", encoding="utf-8", errors="replace") as log_file:
        log_file.write(line)
        log_file.write("\n")


def _tail_log(log_path: Path, tail_lines: int):
    if not log_path.exists():
        return []
    target_lines = _parse_positive_int(tail_lines, DEFAULT_LOG_TAIL_LINES)
    collected = deque(maxlen=target_lines)
    with log_path.open("r", encoding="utf-8", errors="replace") as log_file:
        for line in log_file:
            collected.append(line.rstrip("\n"))
    return list(collected)


def _set_job(
    entry_id: str, status: str, message: str = "", sources=None, error_code=None, storage_dir=None
):
    summary = str(message or "").strip()
    if len(summary) > MAX_STATUS_MESSAGE_CHARS:
        summary = f"{summary[: MAX_STATUS_MESSAGE_CHARS - 3]}..."
    with JOBS_LOCK:
        current = JOBS.get(entry_id, {})
        updated = {
            "entryId": entry_id,
            "status": status,
            "message": summary,
            "sources": sources or [],
            "updatedAt": time.time(),
        }
        if storage_dir:
            updated["storageDir"] = str(storage_dir)
        elif current.get("storageDir"):
            updated["storageDir"] = current.get("storageDir")
        if error_code:
            updated["errorCode"] = error_code
        elif "errorCode" in current and status != "failed":
            updated["errorCode"] = current["errorCode"]
        JOBS[entry_id] = updated


def _set_analysis_job(entry_id: str, status: str, message: str = "", error_code=None, storage_dir=None):
    summary = str(message or "").strip()
    if len(summary) > MAX_STATUS_MESSAGE_CHARS:
        summary = f"{summary[: MAX_STATUS_MESSAGE_CHARS - 3]}..."
    with ANALYSIS_JOBS_LOCK:
        current = ANALYSIS_JOBS.get(entry_id, {})
        updated = {
            "entryId": entry_id,
            "status": status,
            "message": summary,
            "updatedAt": time.time(),
        }
        if storage_dir:
            updated["storageDir"] = str(storage_dir)
        elif current.get("storageDir"):
            updated["storageDir"] = current.get("storageDir")
        if error_code:
            updated["errorCode"] = error_code
        elif "errorCode" in current and status != "failed":
            updated["errorCode"] = current["errorCode"]
        ANALYSIS_JOBS[entry_id] = updated


def _finalize_failure(entry_id: str, log_path: Path, message: str, error_code: str):
    _append_log_line(log_path, "ERROR", f"{error_code}: {message}")
    _set_job(entry_id, "failed", message, error_code=error_code)


def _classify_failure(exit_code: int, log_tail_lines):
    joined = "\n".join(log_tail_lines).lower()
    if "cuda" in joined and ("not available" in joined or "invalid device" in joined):
        return "cuda_unavailable_error", "CUDA device was requested but is not available."
    if "bs-roformer" in joined and ("no module named" in joined or "not found" in joined):
        return "engine_missing_error", "BS-RoFormer tools are not installed in the worker image."
    if "hf_transfer" in joined and "module" in joined:
        return "hf_transfer_missing_error", "HF transfer acceleration dependency is missing."
    if "xet" in joined and "error" in joined:
        return "hf_xet_error", "HF Xet transfer failed."
    if "404" in joined and "huggingface" in joined:
        return "model_not_found_error", "Configured BS-RoFormer model slug was not found."
    if "incompleteread" in joined or "connection broken" in joined:
        return "model_download_incomplete_error", "Model download stream was interrupted."
    if "ffmpeg" in joined and ("error" in joined or "failed" in joined):
        return "ffmpeg_decode_error", "Audio decode failed. Check file format/codec."
    if "no such file or directory" in joined and "ffmpeg" in joined:
        return "ffmpeg_missing_error", "FFmpeg was not available in the worker runtime."
    if (
        "connection" in joined
        or "download" in joined
        or "http error" in joined
        or "urlopen error" in joined
        or "ssl" in joined
    ):
        return "model_download_error", "Model download failed due to network/SSL issue."
    if (
        "out of memory" in joined
        or "cuda out of memory" in joined
        or "killed" in joined
        or exit_code in (-9, 137)
    ):
        return "oom_error", "Separation failed due to memory pressure (OOM/process killed)."
    return "separation_engine_error", "Separation engine process failed."


def _run_logged_command(log_path: Path, command, prefix: str, timeout_seconds: int):
    if log_path:
        _append_log_line(log_path, "INFO", f"{prefix} command: {' '.join(command)}")
    else:
        print(f"{prefix} command: {' '.join(command)}", flush=True)
    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
    except Exception as error:
        return 1, [f"failed to launch command: {error}"]

    log_tail = deque(maxlen=400)

    def _stream_output():
        if not process.stdout:
            return
        for raw_line in process.stdout:
            line = raw_line.rstrip()
            if not line:
                continue
            log_tail.append(line)
            if log_path:
                _append_log_line(log_path, prefix, line)
            else:
                print(line, flush=True)

    stream_thread = threading.Thread(target=_stream_output, daemon=True)
    stream_thread.start()

    try:
        process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        process.kill()
        stream_thread.join(timeout=3)
        return 124, list(log_tail)

    stream_thread.join(timeout=3)
    return int(process.returncode or 0), list(log_tail)


def _detect_bs_roformer_model_paths(models_root: Path, model_slug: str):
    model_dir = models_root / model_slug
    if not model_dir.exists():
        return None, None
    config_candidates = sorted(model_dir.glob("*.yaml"))
    ckpt_candidates = sorted(model_dir.glob("*.ckpt"))
    config_path = config_candidates[0] if config_candidates else None
    ckpt_path = ckpt_candidates[0] if ckpt_candidates else None
    return config_path, ckpt_path


def _bs_roformer_env():
    models_root = Path(
        _parse_nonempty_string(
            os.environ.get("BS_ROFORMER_MODELS_DIR", "/app/worker-models"), "/app/worker-models"
        )
    )
    model_slug = _parse_nonempty_string(
        os.environ.get("BS_ROFORMER_MODEL_SLUG", "roformer-model-bs-roformer-sw-by-jarredou"),
        "roformer-model-bs-roformer-sw-by-jarredou",
    )
    min_ckpt_bytes = _parse_positive_int(os.environ.get("BS_ROFORMER_MIN_CKPT_BYTES", "50000000"), 50000000)
    download_attempts = _parse_positive_int(os.environ.get("BS_ROFORMER_DOWNLOAD_ATTEMPTS", "8"), 8)
    return models_root, model_slug, min_ckpt_bytes, download_attempts


def _assets_valid(config_path: Path, model_path: Path, min_ckpt_bytes: int):
    if not config_path or not model_path:
        return False
    if not config_path.exists() or not model_path.exists():
        return False
    try:
        size = model_path.stat().st_size
    except Exception:
        return False
    return size >= min_ckpt_bytes


def _parse_bool(raw_value, fallback):
    text = str(raw_value or "").strip()
    if not text:
        return fallback
    return text.lower() in ("1", "true", "yes", "on")


def _effective_bs_roformer_overrides():
    overlap = _parse_positive_int(os.environ.get("BS_ROFORMER_INFER_NUM_OVERLAP", "8"), 8)
    chunk_size = _parse_positive_int(os.environ.get("BS_ROFORMER_INFER_CHUNK_SIZE", "882000"), 882000)
    normalize = _parse_bool(os.environ.get("BS_ROFORMER_INFER_NORMALIZE", "1"), True)
    return {
        "num_overlap": overlap,
        "chunk_size": chunk_size,
        "normalize": normalize,
    }


def _resolve_infer_device():
    requested = _parse_nonempty_string(
        os.environ.get("BS_ROFORMER_INFER_DEVICE", "cpu"),
        "cpu",
    ).strip().lower()
    if requested in ("cpu", "cuda", "mps"):
        return requested
    if requested.startswith("cuda:"):
        return requested
    return "cpu"


def _align_chunk_size(chunk_size: int, hop_size: int):
    safe_hop = max(1, int(hop_size))
    safe_chunk = max(safe_hop, int(chunk_size))
    remainder = safe_chunk % safe_hop
    if remainder == 0:
        return safe_chunk
    aligned = safe_chunk - remainder
    if aligned < safe_hop:
        aligned = safe_hop
    return aligned


def _build_effective_config_file(config_path: Path, job_dir: Path, log_path: Path):
    with config_path.open("r", encoding="utf-8") as handle:
        loaded = yaml.load(handle, Loader=_SafeLoaderWithTuple) or {}

    if not isinstance(loaded, dict):
        raise RuntimeError("Invalid BS-RoFormer config YAML structure.")

    audio = loaded.get("audio") or {}
    inference = loaded.get("inference") or {}
    if not isinstance(audio, dict) or not isinstance(inference, dict):
        raise RuntimeError("Invalid BS-RoFormer config sections (audio/inference).")

    overrides = _effective_bs_roformer_overrides()
    model_section = loaded.get("model") or {}
    hop_size = 512
    if isinstance(model_section, dict) and model_section.get("stft_hop_length"):
        hop_size = _parse_positive_int(model_section.get("stft_hop_length"), 512)
    elif audio.get("hop_length"):
        hop_size = _parse_positive_int(audio.get("hop_length"), 512)
    requested_chunk = int(overrides["chunk_size"])
    aligned_chunk = _align_chunk_size(requested_chunk, hop_size)

    audio["chunk_size"] = aligned_chunk
    inference["num_overlap"] = int(overrides["num_overlap"])
    inference["normalize"] = bool(overrides["normalize"])
    loaded["audio"] = audio
    loaded["inference"] = inference

    effective_config_path = job_dir / "effective-config.yaml"
    with effective_config_path.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(loaded, handle, sort_keys=False)

    _append_log_line(
        log_path,
        "INFO",
        (
            "BS-RoFormer effective inference config: "
            f"audio.chunk_size={audio['chunk_size']} (requested={requested_chunk}, hop={hop_size}), "
            f"inference.num_overlap={inference['num_overlap']}, "
            f"inference.normalize={inference['normalize']}"
        ),
    )
    return effective_config_path, overrides


def _should_archive_stem_runs():
    return _parse_bool(os.environ.get("BS_ROFORMER_SAVE_STEMS_PER_RUN", "1"), True)


def _resolve_stem_run_archive_dir(storage_dir: Path, entry_id: str):
    raw_base = _parse_nonempty_string(
        os.environ.get("BS_ROFORMER_STEM_RUNS_DIR", "stem-runs"),
        "stem-runs",
    )
    base_path = Path(raw_base)
    if not base_path.is_absolute():
        base_path = storage_dir / base_path
    timestamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    unique_suffix = f"{int(time.time() * 1000) % 1000:03d}"
    safe_entry = _sanitize_id(entry_id) or "entry"
    return base_path / safe_entry / f"{timestamp}-{unique_suffix}"


def _archive_stem_run(storage_dir: Path, entry_id: str, target_dir: Path, sources, log_path: Path):
    if not _should_archive_stem_runs():
        _append_log_line(log_path, "INFO", "Per-run stem archiving disabled by BS_ROFORMER_SAVE_STEMS_PER_RUN.")
        return None

    archive_dir = _resolve_stem_run_archive_dir(storage_dir, entry_id)
    archive_dir.mkdir(parents=True, exist_ok=True)
    archived = []
    for source in sources or []:
        file_name = source.get("fileName")
        label = source.get("label")
        if not file_name:
            continue
        src_path = target_dir / file_name
        if not src_path.exists():
            continue
        safe_label = _sanitize_label(label or src_path.stem) or src_path.stem
        dest_path = archive_dir / f"{safe_label}.wav"
        shutil.copyfile(src_path, dest_path)
        archived.append(dest_path.name)

    metadata = {
        "entryId": entry_id,
        "savedAtIso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "stemCount": len(archived),
        "stems": archived,
    }
    (archive_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    _append_log_line(log_path, "INFO", f"Archived per-run stems to {archive_dir}")
    return archive_dir


def _ensure_bs_roformer_assets(log_path: Path | None, timeout_seconds: int):
    models_root, model_slug, min_ckpt_bytes, download_attempts = _bs_roformer_env()
    models_root.mkdir(parents=True, exist_ok=True)
    config_path, model_path = _detect_bs_roformer_model_paths(models_root, model_slug)
    if config_path and model_path and _assets_valid(config_path, model_path, min_ckpt_bytes):
        return config_path, model_path, []

    all_tail = []
    for attempt in range(1, download_attempts + 1):
        command = [
            "bs-roformer-download",
            "--model",
            model_slug,
            "--output-dir",
            str(models_root),
        ]
        code, tail = _run_logged_command(log_path, command, "DOWNLOAD", timeout_seconds)
        all_tail = tail or all_tail
        config_path, model_path = _detect_bs_roformer_model_paths(models_root, model_slug)
        if code == 0 and config_path and model_path and _assets_valid(config_path, model_path, min_ckpt_bytes):
            if log_path:
                _append_log_line(log_path, "INFO", f"Model assets ready on attempt {attempt}.")
            else:
                print(f"Model assets ready on attempt {attempt}.", flush=True)
            return config_path, model_path, []
        if log_path:
            _append_log_line(log_path, "WARN", f"Model assets not ready after attempt {attempt}/{download_attempts}.")
        else:
            print(f"Model assets not ready after attempt {attempt}/{download_attempts}.", flush=True)
        time.sleep(min(20, attempt * 2))
    return None, None, all_tail


def _collect_bs_roformer_sources(output_root: Path, target_dir: Path, entry_id: str):
    target_dir.mkdir(parents=True, exist_ok=True)
    preferred_labels = ("vocals", "drums", "bass", "guitar", "piano", "other")
    stem_map = {}
    for wav_path in output_root.rglob("*.wav"):
        stem_name = wav_path.stem.lower()
        for label in preferred_labels:
            if stem_name == label or stem_name.endswith(f"_{label}") or stem_name.startswith(f"{label}_"):
                stem_map[label] = wav_path
                break

    if len(stem_map) < 2:
        for wav_path in output_root.rglob("*.wav"):
            stem_name = _sanitize_label(wav_path.stem)
            if not stem_name or stem_name == _sanitize_label(entry_id):
                continue
            if stem_name in stem_map:
                continue
            stem_map[stem_name] = wav_path

    sources = []
    for label, wav_path in stem_map.items():
        safe_label = _sanitize_label(label)
        if not safe_label:
            continue
        target_file = target_dir / f"{safe_label}.wav"
        shutil.copyfile(wav_path, target_file)
        sources.append({"label": safe_label, "fileName": target_file.name})
    return sources


def _convert_audio_to_wav(log_path: Path, source_path: Path, target_wav_path: Path, timeout_seconds: int):
    if target_wav_path.exists():
        target_wav_path.unlink(missing_ok=True)
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-i",
        str(source_path),
        "-ac",
        "2",
        "-ar",
        "44100",
        str(target_wav_path),
    ]
    return _run_logged_command(log_path, command, "PREP", timeout_seconds)


def _generate_preview(entry_id: str, storage_dir_raw: str, offset_seconds: float, duration_seconds: float):
    storage_dir = Path(storage_dir_raw)
    safe_entry_id = _sanitize_id(entry_id)
    if not safe_entry_id:
        raise RuntimeError("Invalid entry id.")

    log_path = _job_log_path(storage_dir, safe_entry_id)
    if not log_path:
        raise RuntimeError("Invalid entry id.")
    log_path.parent.mkdir(parents=True, exist_ok=True)

    entry, _json_path = _load_saved_entry(storage_dir, safe_entry_id)
    if not entry:
        raise RuntimeError("Saved entry not found.")

    audio = entry.get("audio") if isinstance(entry, dict) else None
    audio_file = str((audio or {}).get("storedFileName") or "").strip() if isinstance(audio, dict) else ""
    if not audio_file:
        raise RuntimeError("Saved entry has no audio reference.")

    input_path = storage_dir / "audio" / audio_file
    if not input_path.exists():
        raise RuntimeError("Saved audio file not found.")

    previews_dir = storage_dir / "previews"
    previews_dir.mkdir(parents=True, exist_ok=True)
    preview_file_name = f"{safe_entry_id}.wav"
    output_path = previews_dir / preview_file_name

    safe_offset = max(0.0, float(offset_seconds))
    safe_duration = max(1.0, float(duration_seconds))
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-ss",
        str(safe_offset),
        "-t",
        str(safe_duration),
        "-i",
        str(input_path),
        "-ac",
        "2",
        "-ar",
        "44100",
        str(output_path),
    ]
    code, tail = _run_logged_command(log_path, command, "PREVIEW", _parse_positive_int(os.environ.get("BEAT_ANALYSIS_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)), DEFAULT_TIMEOUT_SECONDS))
    if code == 124:
        raise RuntimeError("Preview generation timed out.")
    if code != 0 or not output_path.exists():
        detail = tail[-1] if tail else "ffmpeg preview generation failed."
        raise RuntimeError(detail)

    _append_log_line(log_path, "INFO", f"Preview generated: {output_path}")
    return {
        "ok": True,
        "entryId": safe_entry_id,
        "previewFileName": preview_file_name,
        "offsetSeconds": safe_offset,
        "durationSeconds": safe_duration,
    }


def _run_separation(entry_id: str, storage_dir_raw: str):
    storage_dir = Path(storage_dir_raw)
    log_path = _job_log_path(storage_dir, entry_id)
    if not log_path:
        _set_job(entry_id, "failed", "Invalid entry id.", error_code="invalid_entry_id")
        return
    timeout_seconds = _parse_positive_int(
        os.environ.get("BEAT_SEPARATION_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)),
        DEFAULT_TIMEOUT_SECONDS,
    )
    _append_log_line(log_path, "INFO", f"Separation requested for entry '{entry_id}'.")
    entry, json_path = _load_saved_entry(storage_dir, entry_id)
    if not entry or not json_path:
        _finalize_failure(entry_id, log_path, "Saved entry not found.", "entry_not_found")
        return

    audio_file = entry.get("audio", {}).get("storedFileName")
    if not audio_file:
        _finalize_failure(
            entry_id, log_path, "Stored audio reference missing.", "audio_reference_missing"
        )
        return

    audio_path = storage_dir / "audio" / audio_file
    if not audio_path.exists():
        _finalize_failure(entry_id, log_path, "Stored audio file missing.", "audio_missing")
        return

    engine = _parse_nonempty_string(os.environ.get("SEPARATION_ENGINE", "bs_roformer"), "bs_roformer")
    if engine != "bs_roformer":
        _finalize_failure(
            entry_id,
            log_path,
            f"Unsupported separation engine '{engine}'. Expected 'bs_roformer'.",
            "unsupported_engine",
        )
        return

    models_root, model_slug, _, _ = _bs_roformer_env()
    output_base = Path(
        _parse_nonempty_string(os.environ.get("BS_ROFORMER_OUTPUT_DIR", "/app/worker-output"), "/app/worker-output")
    )
    job_input_dir = output_base / entry_id / "input"
    job_output_dir = output_base / entry_id / "output"
    if job_input_dir.exists():
        shutil.rmtree(job_input_dir, ignore_errors=True)
    if job_output_dir.exists():
        shutil.rmtree(job_output_dir, ignore_errors=True)
    job_input_dir.mkdir(parents=True, exist_ok=True)
    job_output_dir.mkdir(parents=True, exist_ok=True)
    local_input_wav = job_input_dir / "input.wav"
    convert_code, convert_tail = _convert_audio_to_wav(
        log_path, audio_path, local_input_wav, timeout_seconds
    )
    if convert_code == 124:
        _finalize_failure(
            entry_id,
            log_path,
            f"Input conversion timed out after {timeout_seconds} seconds.",
            "input_to_wav_conversion_timeout",
        )
        return
    if convert_code != 0 or not local_input_wav.exists():
        _finalize_failure(
            entry_id,
            log_path,
            "Failed to convert input audio to WAV for BS-RoFormer.",
            "input_to_wav_conversion_failed",
        )
        return

    _append_log_line(log_path, "INFO", f"Audio input: {audio_path}")
    _append_log_line(log_path, "INFO", f"Separation engine: {engine}")
    _append_log_line(log_path, "INFO", f"BS-RoFormer model slug: {model_slug}")
    _append_log_line(log_path, "INFO", f"BS-RoFormer models dir: {models_root}")
    _append_log_line(log_path, "INFO", f"BS-RoFormer output dir: {job_output_dir}")
    _append_log_line(log_path, "INFO", f"BS-RoFormer infer device: {_resolve_infer_device()}")
    _set_job(entry_id, "running", "Running source separation...", storage_dir=storage_dir)
    config_path, model_path, download_tail = _ensure_bs_roformer_assets(log_path, timeout_seconds)
    if not config_path or not model_path:
        error_code, error_message = _classify_failure(1, download_tail)
        _finalize_failure(
            entry_id,
            log_path,
            f"{error_message} Model assets are not ready.",
            error_code,
        )
        return
    try:
        effective_config_path, _ = _build_effective_config_file(config_path, output_base / entry_id, log_path)
    except Exception as error:
        _finalize_failure(
            entry_id,
            log_path,
            f"Failed to build effective BS-RoFormer config: {error}",
            "config_override_failed",
        )
        return

    infer_command = [
        "bs-roformer-infer",
        "--config_path",
        str(effective_config_path),
        "--model_path",
        str(model_path),
        "--input_folder",
        str(job_input_dir),
        "--store_dir",
        str(job_output_dir),
        "--device",
        _resolve_infer_device(),
    ]
    infer_code, infer_tail = _run_logged_command(log_path, infer_command, "INFER", timeout_seconds)
    if infer_code == 124:
        _finalize_failure(
            entry_id,
            log_path,
            f"Inference timed out after {timeout_seconds} seconds.",
            "inference_timeout",
        )
        return
    if infer_code != 0:
        error_code, error_message = _classify_failure(infer_code, infer_tail)
        _finalize_failure(entry_id, log_path, error_message, error_code)
        return

    target_dir = storage_dir / "separated" / entry_id
    sources = _collect_bs_roformer_sources(job_output_dir, target_dir, entry_id)
    if not sources:
        _finalize_failure(
            entry_id, log_path, "No BS-RoFormer stem files were produced.", "no_stem_files_produced"
        )
        return

    entry["separatedSources"] = sources
    entry["separationCompletedAtIso"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    json_path.write_text(json.dumps(entry, indent=2), encoding="utf-8")
    archive_dir = _archive_stem_run(storage_dir, entry_id, target_dir, sources, log_path)
    if archive_dir:
        entry["separatedStemArchiveDir"] = str(archive_dir)
        json_path.write_text(json.dumps(entry, indent=2), encoding="utf-8")

    _append_log_line(log_path, "INFO", f"Separation completed with {len(sources)} sources.")
    _set_job(entry_id, "completed", "Separation completed.", sources=sources, storage_dir=storage_dir)


def _run_hybrid_analysis(entry_id: str, storage_dir_raw: str, analysis_overrides=None):
    storage_dir = Path(storage_dir_raw)
    log_path = _analysis_log_path(storage_dir, entry_id)
    result_path = _analysis_result_path(storage_dir, entry_id)
    if not log_path or not result_path:
        _set_analysis_job(entry_id, "failed", "Invalid entry id.", error_code="invalid_entry_id")
        return

    timeout_seconds = _parse_positive_int(
        os.environ.get("BEAT_ANALYSIS_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)),
        DEFAULT_TIMEOUT_SECONDS,
    )
    _append_log_line(log_path, "INFO", f"Hybrid analysis requested for entry '{entry_id}'.")
    entry, json_path = _load_saved_entry(storage_dir, entry_id)
    if not entry or not json_path:
        _append_log_line(log_path, "ERROR", "entry_not_found: Saved entry not found.")
        _set_analysis_job(entry_id, "failed", "Saved entry not found.", error_code="entry_not_found")
        return

    audio_file = entry.get("audio", {}).get("storedFileName")
    if not audio_file:
        _append_log_line(log_path, "ERROR", "audio_reference_missing: Stored audio reference missing.")
        _set_analysis_job(
            entry_id, "failed", "Stored audio reference missing.", error_code="audio_reference_missing"
        )
        return

    audio_path = storage_dir / "audio" / audio_file
    if not audio_path.exists():
        _append_log_line(log_path, "ERROR", "audio_missing: Stored audio file missing.")
        _set_analysis_job(entry_id, "failed", "Stored audio file missing.", error_code="audio_missing")
        return

    output_base = Path(
        _parse_nonempty_string(os.environ.get("BS_ROFORMER_OUTPUT_DIR", "/app/worker-output"), "/app/worker-output")
    )
    analysis_input_dir = output_base / entry_id / "analysis-input"
    if analysis_input_dir.exists():
        shutil.rmtree(analysis_input_dir, ignore_errors=True)
    analysis_input_dir.mkdir(parents=True, exist_ok=True)
    local_input_wav = analysis_input_dir / "input.wav"
    convert_code, convert_tail = _convert_audio_to_wav(log_path, audio_path, local_input_wav, timeout_seconds)
    if convert_code == 124:
        _append_log_line(log_path, "ERROR", "input_to_wav_conversion_timeout: Input conversion timed out.")
        _set_analysis_job(
            entry_id,
            "failed",
            f"Input conversion timed out after {timeout_seconds} seconds.",
            error_code="input_to_wav_conversion_timeout",
        )
        return
    if convert_code != 0 or not local_input_wav.exists():
        _append_log_line(log_path, "ERROR", "input_to_wav_conversion_failed: Failed input conversion.")
        _set_analysis_job(
            entry_id,
            "failed",
            "Failed to convert input audio to WAV for hybrid analysis.",
            error_code="input_to_wav_conversion_failed",
        )
        return

    _set_analysis_job(entry_id, "running", "Running hybrid beat+sustain analysis...", storage_dir=storage_dir)
    overrides = analysis_overrides if isinstance(analysis_overrides, dict) else {}
    analysis_hop_length = _parse_positive_int(
        overrides.get("hopLength", os.environ.get("BEAT_ANALYSIS_HOP_LENGTH", "512")),
        512,
    )
    onset_min_strength = _parse_number(
        overrides.get("onsetMinStrength", os.environ.get("BEAT_ANALYSIS_ONSET_MIN_STRENGTH", "0.10")),
        0.10,
    )
    onset_min_distance_seconds = _parse_number(
        overrides.get(
            "onsetMinDistanceSeconds", os.environ.get("BEAT_ANALYSIS_ONSET_MIN_DISTANCE_SECONDS", "0.11")
        ),
        0.11,
    )
    adaptive_window_seconds = _parse_number(
        overrides.get(
            "adaptiveWindowSeconds", os.environ.get("BEAT_ANALYSIS_ADAPTIVE_WINDOW_SECONDS", "0.45")
        ),
        0.45,
    )
    strict_k = _parse_number(overrides.get("strictK", os.environ.get("BEAT_ANALYSIS_STRICT_K", "1.15")), 1.15)
    permissive_k = _parse_number(
        overrides.get("permissiveK", os.environ.get("BEAT_ANALYSIS_PERMISSIVE_K", "0.62")),
        0.62,
    )
    gap_trigger_seconds = _parse_number(
        overrides.get("gapTriggerSeconds", os.environ.get("BEAT_ANALYSIS_GAP_TRIGGER_SECONDS", "0.24")),
        0.24,
    )
    sustain_min_duration_seconds = _parse_number(
        overrides.get(
            "sustainMinDurationSeconds",
            os.environ.get("BEAT_ANALYSIS_SUSTAIN_MIN_DURATION_SECONDS", "0.08"),
        ),
        0.08,
    )
    sustain_merge_gap_seconds = _parse_number(
        overrides.get(
            "sustainMergeGapSeconds",
            os.environ.get("BEAT_ANALYSIS_SUSTAIN_MERGE_GAP_SECONDS", "0.14"),
        ),
        0.14,
    )
    sustain_bridge_floor = _parse_number(
        overrides.get(
            "sustainBridgeFloor",
            os.environ.get("BEAT_ANALYSIS_SUSTAIN_BRIDGE_FLOOR", "0.25"),
        ),
        0.25,
    )
    sustain_max_pitch_jump_semitones = _parse_number(
        overrides.get(
            "sustainMaxPitchJumpSemitones",
            os.environ.get("BEAT_ANALYSIS_SUSTAIN_MAX_PITCH_JUMP_SEMITONES", "3.0"),
        ),
        3.0,
    )
    sustain_split_on_pitch_change = _parse_bool(
        overrides.get(
            "sustainSplitOnPitchChange",
            os.environ.get("BEAT_ANALYSIS_SUSTAIN_SPLIT_ON_PITCH_CHANGE", "1"),
        ),
        True,
    )
    sustain_min_pitch_confidence = _parse_number(
        overrides.get(
            "sustainMinPitchConfidence",
            os.environ.get("BEAT_ANALYSIS_SUSTAIN_MIN_PITCH_CONFIDENCE", "0.45"),
        ),
        0.45,
    )
    sustain_enable_continuous_pitch_split = _parse_bool(
        overrides.get(
            "sustainEnableContinuousPitchSplit",
            os.environ.get("BEAT_ANALYSIS_SUSTAIN_ENABLE_CONTINUOUS_PITCH_SPLIT", "1"),
        ),
        True,
    )
    sustain_pitch_split_threshold_semitones = _parse_number(
        overrides.get(
            "sustainPitchSplitThresholdSemitones",
            os.environ.get("BEAT_ANALYSIS_SUSTAIN_PITCH_SPLIT_THRESHOLD_SEMITONES", "0.75"),
        ),
        0.75,
    )
    sustain_pitch_split_min_segment_seconds = _parse_number(
        overrides.get(
            "sustainPitchSplitMinSegmentSeconds",
            os.environ.get("BEAT_ANALYSIS_SUSTAIN_PITCH_SPLIT_MIN_SEGMENT_SECONDS", "0.20"),
        ),
        0.20,
    )
    sustain_pitch_split_min_voiced_probability = _parse_number(
        overrides.get(
            "sustainPitchSplitMinVoicedProbability",
            os.environ.get("BEAT_ANALYSIS_SUSTAIN_PITCH_SPLIT_MIN_VOICED_PROBABILITY", "0.70"),
        ),
        0.70,
    )
    low_fmin = _parse_number(overrides.get("lowFmin", os.environ.get("BEAT_ANALYSIS_LOW_FMIN", "20")), 20.0)
    low_fmax = _parse_number(overrides.get("lowFmax", os.environ.get("BEAT_ANALYSIS_LOW_FMAX", "180")), 180.0)
    mid_fmin = _parse_number(overrides.get("midFmin", os.environ.get("BEAT_ANALYSIS_MID_FMIN", "180")), 180.0)
    mid_fmax = _parse_number(overrides.get("midFmax", os.environ.get("BEAT_ANALYSIS_MID_FMAX", "2200")), 2200.0)
    high_fmin = _parse_number(
        overrides.get("highFmin", os.environ.get("BEAT_ANALYSIS_HIGH_FMIN", "2200")),
        2200.0,
    )
    high_fmax = _parse_number(
        overrides.get("highFmax", os.environ.get("BEAT_ANALYSIS_HIGH_FMAX", "12000")),
        12000.0,
    )
    low_weight = _parse_number(
        overrides.get("lowWeight", os.environ.get("BEAT_ANALYSIS_LOW_WEIGHT", "1.15")),
        1.15,
    )
    mid_weight = _parse_number(
        overrides.get("midWeight", os.environ.get("BEAT_ANALYSIS_MID_WEIGHT", "1.0")),
        1.0,
    )
    high_weight = _parse_number(
        overrides.get("highWeight", os.environ.get("BEAT_ANALYSIS_HIGH_WEIGHT", "0.9")),
        0.9,
    )
    onset_min_strength = max(0.0, min(1.0, onset_min_strength))
    onset_min_distance_seconds = max(0.01, onset_min_distance_seconds)
    adaptive_window_seconds = max(0.05, adaptive_window_seconds)
    gap_trigger_seconds = max(0.02, gap_trigger_seconds)
    sustain_min_duration_seconds = max(0.02, sustain_min_duration_seconds)
    sustain_merge_gap_seconds = max(0.0, sustain_merge_gap_seconds)
    sustain_bridge_floor = max(0.0, sustain_bridge_floor)
    sustain_max_pitch_jump_semitones = max(0.0, sustain_max_pitch_jump_semitones)
    sustain_min_pitch_confidence = max(0.0, min(1.0, sustain_min_pitch_confidence))
    sustain_pitch_split_threshold_semitones = max(0.0, sustain_pitch_split_threshold_semitones)
    sustain_pitch_split_min_segment_seconds = max(0.02, sustain_pitch_split_min_segment_seconds)
    sustain_pitch_split_min_voiced_probability = max(
        0.0, min(1.0, sustain_pitch_split_min_voiced_probability)
    )
    strict_k = max(0.0, strict_k)
    permissive_k = max(0.0, permissive_k)
    low_fmin = max(1.0, low_fmin)
    low_fmax = max(low_fmin + 1.0, low_fmax)
    mid_fmin = max(low_fmin + 1.0, mid_fmin)
    mid_fmax = max(mid_fmin + 1.0, mid_fmax)
    high_fmin = max(mid_fmin + 1.0, high_fmin)
    high_fmax = max(high_fmin + 1.0, high_fmax)
    low_weight = max(0.0, low_weight)
    mid_weight = max(0.0, mid_weight)
    high_weight = max(0.0, high_weight)
    command = [
        "python3",
        "worker/hybrid_analyze.py",
        "--input",
        str(local_input_wav),
        "--output",
        str(result_path),
        "--hop-length",
        str(analysis_hop_length),
        "--onset-min-strength",
        str(onset_min_strength),
        "--onset-min-distance-seconds",
        str(onset_min_distance_seconds),
        "--adaptive-window-seconds",
        str(adaptive_window_seconds),
        "--strict-k",
        str(strict_k),
        "--permissive-k",
        str(permissive_k),
        "--gap-trigger-seconds",
        str(gap_trigger_seconds),
        "--sustain-min-duration-seconds",
        str(sustain_min_duration_seconds),
        "--sustain-merge-gap-seconds",
        str(sustain_merge_gap_seconds),
        "--sustain-bridge-floor",
        str(sustain_bridge_floor),
        "--sustain-max-pitch-jump-semitones",
        str(sustain_max_pitch_jump_semitones),
        "--sustain-split-on-pitch-change",
        str(1 if sustain_split_on_pitch_change else 0),
        "--sustain-min-pitch-confidence",
        str(sustain_min_pitch_confidence),
        "--sustain-enable-continuous-pitch-split",
        str(1 if sustain_enable_continuous_pitch_split else 0),
        "--sustain-pitch-split-threshold-semitones",
        str(sustain_pitch_split_threshold_semitones),
        "--sustain-pitch-split-min-segment-seconds",
        str(sustain_pitch_split_min_segment_seconds),
        "--sustain-pitch-split-min-voiced-probability",
        str(sustain_pitch_split_min_voiced_probability),
        "--low-fmin",
        str(low_fmin),
        "--low-fmax",
        str(low_fmax),
        "--mid-fmin",
        str(mid_fmin),
        "--mid-fmax",
        str(mid_fmax),
        "--high-fmin",
        str(high_fmin),
        "--high-fmax",
        str(high_fmax),
        "--low-weight",
        str(low_weight),
        "--mid-weight",
        str(mid_weight),
        "--high-weight",
        str(high_weight),
    ]
    code, tail = _run_logged_command(log_path, command, "ANALYZE", timeout_seconds)
    if code == 124:
        _append_log_line(log_path, "ERROR", "analysis_timeout: Hybrid analysis timed out.")
        _set_analysis_job(
            entry_id,
            "failed",
            f"Hybrid analysis timed out after {timeout_seconds} seconds.",
            error_code="analysis_timeout",
        )
        return
    if code != 0 or not result_path.exists():
        _append_log_line(log_path, "ERROR", "analysis_failed: Hybrid analysis command failed.")
        _set_analysis_job(
            entry_id,
            "failed",
            "Hybrid analysis process failed.",
            error_code="analysis_failed",
        )
        return

    try:
        analysis_result = json.loads(result_path.read_text(encoding="utf-8"))
    except Exception as error:
        _append_log_line(log_path, "ERROR", f"analysis_result_invalid: {error}")
        _set_analysis_job(
            entry_id,
            "failed",
            "Hybrid analysis result was invalid JSON.",
            error_code="analysis_result_invalid",
        )
        return

    entry["hybridAnalysis"] = {
        "storedFileName": result_path.name,
        "updatedAtIso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "majorBeatCount": len(analysis_result.get("majorBeats", [])),
        "sustainCount": len(analysis_result.get("sustains", [])),
        "algorithm": analysis_result.get("algorithm", "hybrid"),
    }
    json_path.write_text(json.dumps(entry, indent=2), encoding="utf-8")
    _append_log_line(log_path, "INFO", "Hybrid analysis completed.")
    _set_analysis_job(entry_id, "completed", "Hybrid analysis completed.", storage_dir=storage_dir)


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        _json_response(self, 204, {})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/preview":
            try:
                body = _read_json(self)
                entry_id = str(body.get("entryId", "")).strip()
                storage_dir = str(body.get("storageDir", "")).strip()
                offset_seconds = _parse_number(body.get("offsetSeconds"), 30.0)
                duration_seconds = _parse_number(body.get("durationSeconds"), 15.0)
                if not entry_id or not storage_dir:
                    _json_response(self, 400, {"error": "entryId and storageDir are required."})
                    return
                payload = _generate_preview(entry_id, storage_dir, offset_seconds, duration_seconds)
                _json_response(self, 200, payload)
                return
            except Exception as error:
                _json_response(self, 500, {"error": str(error)})
                return
        if parsed.path == "/separate":
            try:
                body = _read_json(self)
                entry_id = str(body.get("entryId", "")).strip()
                storage_dir = str(body.get("storageDir", "")).strip()
                if not entry_id or not storage_dir:
                    _json_response(self, 400, {"error": "entryId and storageDir are required."})
                    return
                with JOBS_LOCK:
                    existing = JOBS.get(entry_id)
                    if existing and existing.get("status") == "running":
                        _json_response(self, 200, {"ok": True, "status": "running"})
                        return
                _set_job(entry_id, "queued", "Queued separation job.", storage_dir=storage_dir)
                thread = threading.Thread(target=_run_separation, args=(entry_id, storage_dir), daemon=True)
                thread.start()
                _json_response(self, 200, {"ok": True, "status": "queued"})
                return
            except Exception as error:
                _json_response(self, 500, {"error": str(error)})
                return
        if parsed.path == "/analyze":
            try:
                body = _read_json(self)
                entry_id = str(body.get("entryId", "")).strip()
                storage_dir = str(body.get("storageDir", "")).strip()
                analysis_overrides = body.get("analysisOverrides")
                if not entry_id or not storage_dir:
                    _json_response(self, 400, {"error": "entryId and storageDir are required."})
                    return
                with ANALYSIS_JOBS_LOCK:
                    existing = ANALYSIS_JOBS.get(entry_id)
                    if existing and existing.get("status") == "running":
                        _json_response(self, 200, {"ok": True, "status": "running"})
                        return
                _set_analysis_job(entry_id, "queued", "Queued analysis job.", storage_dir=storage_dir)
                thread = threading.Thread(
                    target=_run_hybrid_analysis,
                    args=(entry_id, storage_dir, analysis_overrides),
                    daemon=True,
                )
                thread.start()
                _json_response(self, 200, {"ok": True, "status": "queued"})
                return
            except Exception as error:
                _json_response(self, 500, {"error": str(error)})
                return

        _json_response(self, 404, {"error": "Not found."})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/status/"):
            entry_id = parsed.path[len("/status/") :]
            with JOBS_LOCK:
                job = JOBS.get(entry_id)
            if not job:
                _json_response(self, 404, {"error": "Job not found."})
                return
            payload = {
                "ok": True,
                "entryId": job.get("entryId"),
                "status": job.get("status"),
                "message": job.get("message", ""),
                "updatedAt": job.get("updatedAt"),
            }
            if job.get("status") == "completed":
                payload["sources"] = job.get("sources", [])
            if job.get("errorCode"):
                payload["errorCode"] = job.get("errorCode")
            _json_response(self, 200, payload)
            return

        if parsed.path.startswith("/log/"):
            entry_id = parsed.path[len("/log/") :]
            if not entry_id:
                _json_response(self, 400, {"error": "Missing entry id."})
                return
            with JOBS_LOCK:
                job = JOBS.get(entry_id)
            if not job:
                _json_response(self, 404, {"error": "Job not found."})
                return
            query = parsed.query or ""
            tail_lines = DEFAULT_LOG_TAIL_LINES
            for pair in query.split("&"):
                if pair.startswith("tail="):
                    tail_lines = _parse_positive_int(pair.replace("tail=", "", 1), tail_lines)
                    break
            storage_dir = job.get("storageDir") or os.environ.get("BEAT_STORAGE_DIR", "beat-storage")
            log_path = _job_log_path(Path(storage_dir), entry_id)
            if not log_path:
                _json_response(self, 400, {"error": "Invalid entry id."})
                return
            _json_response(
                self,
                200,
                {
                    "ok": True,
                    "entryId": entry_id,
                    "status": job.get("status"),
                    "message": job.get("message", ""),
                    "errorCode": job.get("errorCode"),
                    "tailLines": _tail_log(log_path, tail_lines),
                    "logFilePath": str(log_path),
                },
            )
            return

        if parsed.path.startswith("/analyze-status/"):
            entry_id = parsed.path[len("/analyze-status/") :]
            with ANALYSIS_JOBS_LOCK:
                job = ANALYSIS_JOBS.get(entry_id)
            if not job:
                _json_response(self, 404, {"error": "Analysis job not found."})
                return
            payload = {
                "ok": True,
                "entryId": job.get("entryId"),
                "status": job.get("status"),
                "message": job.get("message", ""),
                "updatedAt": job.get("updatedAt"),
            }
            if job.get("errorCode"):
                payload["errorCode"] = job.get("errorCode")
            _json_response(self, 200, payload)
            return

        if parsed.path.startswith("/analyze-result/"):
            entry_id = parsed.path[len("/analyze-result/") :]
            with ANALYSIS_JOBS_LOCK:
                job = ANALYSIS_JOBS.get(entry_id)
            storage_dir = None
            if job and job.get("storageDir"):
                storage_dir = Path(job.get("storageDir"))
            else:
                storage_dir = Path(os.environ.get("BEAT_STORAGE_DIR", "beat-storage"))
            result_path = _analysis_result_path(storage_dir, entry_id)
            if not result_path or not result_path.exists():
                _json_response(self, 404, {"error": "Analysis result not found."})
                return
            try:
                payload = json.loads(result_path.read_text(encoding="utf-8"))
            except Exception:
                _json_response(self, 500, {"error": "Failed to read analysis result."})
                return
            _json_response(self, 200, {"ok": True, "entryId": entry_id, "result": payload})
            return

        _json_response(self, 404, {"error": "Not found."})


if __name__ == "__main__":
    port = int(os.environ.get("SEPARATION_WORKER_PORT", "8792"))
    if _is_truthy(os.environ.get("BS_ROFORMER_BOOTSTRAP_ON_START", "1")):
        bootstrap_timeout = _parse_positive_int(
            os.environ.get("BS_ROFORMER_BOOTSTRAP_TIMEOUT_SECONDS", "1800"), 1800
        )
        print("Bootstrapping BS-RoFormer model assets...", flush=True)
        config_path, model_path, tail = _ensure_bs_roformer_assets(None, bootstrap_timeout)
        if config_path and model_path:
            print(f"BS-RoFormer assets ready: {config_path} | {model_path}", flush=True)
        else:
            print("BS-RoFormer bootstrap did not complete. Worker will retry during job execution.", flush=True)
            if tail:
                for line in tail[-5:]:
                    print(line, flush=True)
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Separation worker listening on http://0.0.0.0:{port}")
    server.serve_forever()
