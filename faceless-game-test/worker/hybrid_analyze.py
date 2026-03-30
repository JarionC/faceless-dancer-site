import argparse
import json
import math
from pathlib import Path

import librosa
import numpy as np
from scipy.signal import find_peaks


def _normalize(values):
    arr = np.nan_to_num(np.asarray(values, dtype=float), nan=0.0, posinf=0.0, neginf=0.0)
    max_value = float(np.max(arr)) if arr.size > 0 else 0.0
    if max_value <= 0:
        return np.zeros_like(arr)
    return arr / max_value


def _parse_note_events(note_events, min_duration_seconds=0.08, min_pitch_confidence=0.45):
    parsed = []
    if not isinstance(note_events, (list, tuple)):
        return parsed
    for event in note_events:
        start = None
        end = None
        pitch = None
        confidence = None
        if isinstance(event, dict):
            start = event.get("start_time_s", event.get("start"))
            end = event.get("end_time_s", event.get("end"))
            pitch = event.get("pitch_midi", event.get("pitch"))
            confidence = event.get("amplitude", event.get("confidence", 0.5))
        elif isinstance(event, (list, tuple)) and len(event) >= 2:
            start = event[0]
            end = event[1]
            if len(event) >= 3:
                pitch = event[2]
            if len(event) >= 4:
                confidence = event[3]
        try:
            s = float(start)
            e = float(end)
        except Exception:
            continue
        if not math.isfinite(s) or not math.isfinite(e) or e <= s:
            continue
        conf = 0.5
        try:
            conf = float(confidence)
        except Exception:
            conf = 0.5
        duration = max(0.0, e - s)
        if duration < max(0.0, float(min_duration_seconds)):
            continue
        if pitch is not None and conf < max(0.0, float(min_pitch_confidence)):
            continue
        parsed.append(
            {
                "startSeconds": max(0.0, s),
                "endSeconds": max(0.0, e),
                "durationSeconds": duration,
                "strength": max(0.0, min(1.0, conf)),
                "pitchMidi": None if pitch is None else float(pitch),
            }
        )
    return parsed


def _fallback_sustains(y_harmonic, sr, hop_length, min_duration_seconds=0.08):
    rms = librosa.feature.rms(y=y_harmonic, frame_length=2048, hop_length=hop_length)[0]
    if rms.size == 0:
        return []
    norm = _normalize(rms)
    threshold = max(0.06, float(np.percentile(norm, 70)))
    times = librosa.frames_to_time(np.arange(norm.shape[0]), sr=sr, hop_length=hop_length)
    out = []
    start_idx = None
    peak = 0.0
    for i, value in enumerate(norm):
        if start_idx is None:
            if value >= threshold:
                start_idx = i
                peak = float(value)
            continue
        peak = max(peak, float(value))
        if value >= threshold * 0.85:
            continue
        s = float(times[start_idx])
        e = float(times[i])
        if e - s >= max(0.0, float(min_duration_seconds)):
            out.append(
                {
                    "startSeconds": max(0.0, s),
                    "endSeconds": max(0.0, e),
                    "durationSeconds": max(0.0, e - s),
                    "strength": max(0.0, min(1.0, peak)),
                    "pitchMidi": None,
                }
            )
        start_idx = None
        peak = 0.0
    if start_idx is not None:
        s = float(times[start_idx])
        e = float(times[-1]) if times.size > 0 else s
        if e - s >= max(0.0, float(min_duration_seconds)):
            out.append(
                {
                    "startSeconds": max(0.0, s),
                    "endSeconds": max(0.0, e),
                    "durationSeconds": max(0.0, e - s),
                    "strength": max(0.0, min(1.0, peak)),
                    "pitchMidi": None,
                }
            )
    return out


def _sustain_bridge_env(y, sr, hop_length):
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop_length)[0]
    if rms.size == 0:
        return np.array([], dtype=float), np.array([], dtype=float)
    env = _normalize(rms)
    times = librosa.frames_to_time(np.arange(env.shape[0]), sr=sr, hop_length=hop_length)
    return np.asarray(times, dtype=float), np.asarray(env, dtype=float)


def _mean_env_between(start_s, end_s, times, env):
    if times.size == 0 or env.size == 0:
        return 0.0
    if end_s <= start_s:
        return 1.0
    mask = (times >= float(start_s)) & (times <= float(end_s))
    if not np.any(mask):
        return 0.0
    return float(np.mean(env[mask]))


def _merge_sustains(
    events,
    merge_gap_seconds=0.14,
    bridge_floor=0.25,
    max_pitch_jump_semitones=3.0,
    split_on_pitch_change=False,
    bridge_times=None,
    bridge_env=None,
):
    if not events:
        return []
    sorted_events = sorted(events, key=lambda item: (float(item.get("startSeconds", 0.0)), -float(item.get("endSeconds", 0.0))))
    merged = [dict(sorted_events[0])]
    for incoming in sorted_events[1:]:
        current = merged[-1]
        cur_start = float(current.get("startSeconds", 0.0))
        cur_end = float(current.get("endSeconds", cur_start))
        nxt_start = float(incoming.get("startSeconds", 0.0))
        nxt_end = float(incoming.get("endSeconds", nxt_start))
        gap = nxt_start - cur_end
        can_merge = False
        if gap <= float(merge_gap_seconds):
            if gap <= 0:
                can_merge = True
            else:
                cur_strength = max(1e-6, float(current.get("strength", 0.0)))
                nxt_strength = max(1e-6, float(incoming.get("strength", 0.0)))
                bridge_level = _mean_env_between(cur_end, nxt_start, bridge_times, bridge_env)
                required = float(bridge_floor) * min(cur_strength, nxt_strength)
                can_merge = bridge_level >= required
        cur_pitch = current.get("pitchMidi")
        nxt_pitch = incoming.get("pitchMidi")
        if can_merge and cur_pitch is not None and nxt_pitch is not None:
            jump = abs(float(cur_pitch) - float(nxt_pitch))
            if split_on_pitch_change and jump > 1e-3:
                can_merge = False
            elif jump > float(max_pitch_jump_semitones):
                can_merge = False

        if not can_merge:
            merged.append(dict(incoming))
            continue
        current["endSeconds"] = max(cur_end, nxt_end)
        current["durationSeconds"] = max(0.0, float(current["endSeconds"]) - cur_start)
        current["strength"] = max(float(current.get("strength", 0.0)), float(incoming.get("strength", 0.0)))
        if cur_pitch is None or nxt_pitch is None:
            current["pitchMidi"] = None
        else:
            current["pitchMidi"] = (float(cur_pitch) + float(nxt_pitch)) * 0.5
    return merged


def _estimate_pitch_contour(y_harmonic, sr, hop_length):
    try:
        f0, voiced_flag, voiced_prob = librosa.pyin(
            y_harmonic,
            fmin=librosa.note_to_hz("C2"),
            fmax=librosa.note_to_hz("C7"),
            sr=sr,
            hop_length=hop_length,
        )
    except Exception:
        return np.array([], dtype=float), np.array([], dtype=float), np.array([], dtype=float)
    if f0 is None:
        return np.array([], dtype=float), np.array([], dtype=float), np.array([], dtype=float)
    pitch_hz = np.asarray(f0, dtype=float)
    pitch_midi = librosa.hz_to_midi(pitch_hz)
    times = librosa.frames_to_time(np.arange(pitch_midi.shape[0]), sr=sr, hop_length=hop_length)
    if voiced_prob is None:
        voiced_prob = np.where(np.isfinite(pitch_midi), 1.0, 0.0)
    voiced_prob_arr = np.asarray(voiced_prob, dtype=float)
    if voiced_flag is not None:
        voiced_flag_arr = np.asarray(voiced_flag, dtype=bool)
        voiced_prob_arr = np.where(voiced_flag_arr, voiced_prob_arr, 0.0)
    return np.asarray(times, dtype=float), np.asarray(pitch_midi, dtype=float), voiced_prob_arr


def _slice_event_pitch_values(start_s, end_s, contour_times, contour_pitch_midi, contour_voiced_prob, min_voiced_probability):
    if contour_times.size == 0:
        return np.array([], dtype=float), np.array([], dtype=float)
    mask = (contour_times >= float(start_s)) & (contour_times <= float(end_s))
    if not np.any(mask):
        return np.array([], dtype=float), np.array([], dtype=float)
    event_times = contour_times[mask]
    event_pitch = contour_pitch_midi[mask]
    event_voiced_prob = contour_voiced_prob[mask]
    valid = np.isfinite(event_pitch) & np.isfinite(event_voiced_prob) & (event_voiced_prob >= float(min_voiced_probability))
    if not np.any(valid):
        return np.array([], dtype=float), np.array([], dtype=float)
    return np.asarray(event_times[valid], dtype=float), np.asarray(event_pitch[valid], dtype=float)


def _create_segment(event, start_s, end_s, pitch_values):
    segment = dict(event)
    segment["startSeconds"] = max(0.0, float(start_s))
    segment["endSeconds"] = max(float(start_s), float(end_s))
    segment["durationSeconds"] = max(0.0, float(segment["endSeconds"]) - float(segment["startSeconds"]))
    if pitch_values.size > 0:
        segment["pitchMidi"] = float(np.median(pitch_values))
    return segment


def _split_single_sustain_by_contour(
    event,
    contour_times,
    contour_pitch_midi,
    contour_voiced_prob,
    threshold_semitones,
    min_segment_seconds,
    min_voiced_probability,
):
    start_s = float(event.get("startSeconds", 0.0))
    end_s = float(event.get("endSeconds", start_s))
    if end_s <= start_s:
        return [dict(event)]
    if end_s - start_s < max(0.0, float(min_segment_seconds)) * 2.0:
        return [dict(event)]
    event_times, event_pitches = _slice_event_pitch_values(
        start_s,
        end_s,
        contour_times,
        contour_pitch_midi,
        contour_voiced_prob,
        min_voiced_probability,
    )
    if event_times.size < 3:
        return [dict(event)]
    threshold = max(0.0, float(threshold_semitones))
    if threshold <= 1e-6:
        return [dict(event)]

    split_points = []
    segment_anchor = float(event_pitches[0])
    segment_start_time = start_s
    for idx in range(1, int(event_times.size)):
        cur_time = float(event_times[idx])
        cur_pitch = float(event_pitches[idx])
        if not math.isfinite(cur_pitch):
            continue
        if abs(cur_pitch - segment_anchor) < threshold:
            continue
        if cur_time - segment_start_time < float(min_segment_seconds):
            continue
        if end_s - cur_time < float(min_segment_seconds):
            continue
        split_points.append(cur_time)
        segment_start_time = cur_time
        segment_anchor = cur_pitch

    if not split_points:
        return [dict(event)]

    boundaries = [start_s, *split_points, end_s]
    segments = []
    for idx in range(len(boundaries) - 1):
        seg_start = float(boundaries[idx])
        seg_end = float(boundaries[idx + 1])
        if seg_end - seg_start < float(min_segment_seconds):
            if segments:
                segments[-1]["endSeconds"] = seg_end
                segments[-1]["durationSeconds"] = max(
                    0.0, float(segments[-1]["endSeconds"]) - float(segments[-1]["startSeconds"])
                )
            continue
        seg_times, seg_pitches = _slice_event_pitch_values(
            seg_start,
            seg_end,
            contour_times,
            contour_pitch_midi,
            contour_voiced_prob,
            min_voiced_probability,
        )
        _ = seg_times
        segments.append(_create_segment(event, seg_start, seg_end, seg_pitches))

    if not segments:
        return [dict(event)]
    return segments


def _split_sustains_by_pitch_contour(
    sustains,
    contour_times,
    contour_pitch_midi,
    contour_voiced_prob,
    enabled,
    threshold_semitones,
    min_segment_seconds,
    min_voiced_probability,
):
    if not enabled or not sustains:
        return sustains
    if contour_times.size == 0 or contour_pitch_midi.size == 0:
        return sustains
    output = []
    for event in sustains:
        output.extend(
            _split_single_sustain_by_contour(
                event,
                contour_times,
                contour_pitch_midi,
                contour_voiced_prob,
                threshold_semitones,
                min_segment_seconds,
                min_voiced_probability,
            )
        )
    output.sort(key=lambda item: (float(item.get("startSeconds", 0.0)), float(item.get("endSeconds", 0.0))))
    return output


def _onset_env_band(y, sr, hop_length, fmin, fmax, n_mels=96):
    nyquist = max(1.0, float(sr) * 0.5)
    safe_fmin = max(1.0, min(float(fmin), nyquist - 1.0))
    safe_fmax = max(safe_fmin + 1.0, min(float(fmax), nyquist))
    mel = librosa.feature.melspectrogram(
        y=y,
        sr=sr,
        hop_length=hop_length,
        n_fft=2048,
        n_mels=n_mels,
        fmin=safe_fmin,
        fmax=safe_fmax,
        power=2.0,
    )
    log_mel = librosa.power_to_db(mel + 1e-10)
    onset_env = librosa.onset.onset_strength(S=log_mel, sr=sr, hop_length=hop_length)
    return _normalize(onset_env)


def _adaptive_filter(peaks, env, window_frames, k_value, strength_floor):
    if len(peaks) == 0:
        return np.array([], dtype=int)
    accepted = []
    for peak in peaks:
        left = max(0, int(peak - window_frames))
        right = min(len(env), int(peak + window_frames + 1))
        local = env[left:right]
        if local.size == 0:
            continue
        median = float(np.median(local))
        iqr = float(np.percentile(local, 75) - np.percentile(local, 25))
        threshold = max(strength_floor, median + k_value * iqr)
        if env[peak] >= threshold:
            accepted.append(int(peak))
    return np.array(accepted, dtype=int)


def _gap_fill(strict_peaks, permissive_peaks, env, min_distance_frames, gap_trigger_frames):
    strict = sorted([int(p) for p in strict_peaks])
    if len(strict) < 2:
        return strict
    permissive = [int(p) for p in permissive_peaks]
    selected = list(strict)
    for i in range(len(strict) - 1):
        a = strict[i]
        b = strict[i + 1]
        if b - a < gap_trigger_frames:
            continue
        in_gap = [p for p in permissive if a < p < b]
        if not in_gap:
            continue
        in_gap.sort(key=lambda idx: float(env[idx]), reverse=True)
        for candidate in in_gap:
            if all(abs(candidate - existing) >= min_distance_frames for existing in selected):
                selected.append(candidate)
                break
    return sorted(selected)


def _detect_band_peaks(
    env,
    min_distance_frames,
    window_frames,
    strict_k,
    permissive_k,
    strength_floor,
    gap_trigger_frames,
):
    peaks, _ = find_peaks(env, distance=max(1, int(min_distance_frames)))
    strict = _adaptive_filter(peaks, env, window_frames, strict_k, strength_floor)
    permissive = _adaptive_filter(peaks, env, window_frames, permissive_k, strength_floor * 0.75)
    return _gap_fill(strict, permissive, env, min_distance_frames, gap_trigger_frames)


def _indices_to_points(indices, times, env):
    points = []
    for idx in indices:
        i = int(max(0, min(idx, len(times) - 1)))
        points.append({"timeSeconds": float(times[i]), "strength": float(max(0.0, min(1.0, env[i])))})
    return points


def run_analysis(
    input_path: Path,
    output_path: Path,
    hop_length: int,
    onset_min_strength: float,
    min_distance_seconds: float,
    adaptive_window_seconds: float,
    strict_k: float,
    permissive_k: float,
    gap_trigger_seconds: float,
    sustain_min_duration_seconds: float,
    sustain_merge_gap_seconds: float,
    sustain_bridge_floor: float,
    sustain_max_pitch_jump_semitones: float,
    sustain_split_on_pitch_change: bool,
    sustain_min_pitch_confidence: float,
    sustain_enable_continuous_pitch_split: bool,
    sustain_pitch_split_threshold_semitones: float,
    sustain_pitch_split_min_segment_seconds: float,
    sustain_pitch_split_min_voiced_probability: float,
    low_fmin: float,
    low_fmax: float,
    mid_fmin: float,
    mid_fmax: float,
    high_fmin: float,
    high_fmax: float,
    low_weight: float,
    mid_weight: float,
    high_weight: float,
):
    y, sr = librosa.load(str(input_path), sr=None, mono=True)
    if y.size == 0:
        raise RuntimeError("Loaded audio was empty.")

    low_env = _onset_env_band(y, sr, hop_length, low_fmin, low_fmax)
    mid_env = _onset_env_band(y, sr, hop_length, mid_fmin, mid_fmax)
    high_env = _onset_env_band(y, sr, hop_length, high_fmin, high_fmax)

    combined_env = _normalize(low_weight * low_env + mid_weight * mid_env + high_weight * high_env)
    frame_times = librosa.frames_to_time(np.arange(combined_env.shape[0]), sr=sr, hop_length=hop_length)

    min_distance_frames = max(1, int(round(min_distance_seconds * sr / hop_length)))
    window_frames = max(4, int(round(adaptive_window_seconds * sr / hop_length)))
    gap_trigger_frames = max(min_distance_frames + 1, int(round(gap_trigger_seconds * sr / hop_length)))

    low_peaks = _detect_band_peaks(
        low_env,
        min_distance_frames,
        window_frames,
        strict_k,
        permissive_k,
        onset_min_strength,
        gap_trigger_frames,
    )
    mid_peaks = _detect_band_peaks(
        mid_env,
        min_distance_frames,
        window_frames,
        strict_k,
        permissive_k,
        onset_min_strength,
        gap_trigger_frames,
    )
    high_peaks = _detect_band_peaks(
        high_env,
        min_distance_frames,
        window_frames,
        strict_k,
        permissive_k,
        onset_min_strength,
        gap_trigger_frames,
    )
    combined_peaks = _detect_band_peaks(
        combined_env,
        min_distance_frames,
        window_frames,
        strict_k,
        permissive_k,
        onset_min_strength,
        gap_trigger_frames,
    )

    _, beat_frames = librosa.beat.beat_track(onset_envelope=combined_env, sr=sr, hop_length=hop_length, units="frames")
    tempo = float(librosa.feature.tempo(onset_envelope=combined_env, sr=sr, hop_length=hop_length)[0]) if combined_env.size > 0 else 0.0

    major_beats = _indices_to_points(combined_peaks, frame_times, combined_env)
    band_beats = {
        "low": _indices_to_points(low_peaks, frame_times, low_env),
        "mid": _indices_to_points(mid_peaks, frame_times, mid_env),
        "high": _indices_to_points(high_peaks, frame_times, high_env),
        "combined": major_beats,
    }

    sustains = []
    sustain_source = "fallback_harmonic"
    y_harmonic = librosa.effects.harmonic(y)
    try:
        from basic_pitch.inference import predict

        _, _, note_events = predict(str(input_path))
        sustains = _parse_note_events(
            note_events,
            min_duration_seconds=sustain_min_duration_seconds,
            min_pitch_confidence=sustain_min_pitch_confidence,
        )
        if sustains:
            sustain_source = "basic_pitch"
    except Exception:
        pass

    if not sustains:
        sustains = _fallback_sustains(y_harmonic, sr, hop_length, sustain_min_duration_seconds)

    bridge_times, bridge_env = _sustain_bridge_env(y_harmonic, sr, hop_length)
    sustains = _merge_sustains(
        sustains,
        merge_gap_seconds=sustain_merge_gap_seconds,
        bridge_floor=sustain_bridge_floor,
        max_pitch_jump_semitones=sustain_max_pitch_jump_semitones,
        split_on_pitch_change=bool(sustain_split_on_pitch_change),
        bridge_times=bridge_times,
        bridge_env=bridge_env,
    )
    contour_times, contour_pitch_midi, contour_voiced_prob = _estimate_pitch_contour(y_harmonic, sr, hop_length)
    sustains = _split_sustains_by_pitch_contour(
        sustains,
        contour_times,
        contour_pitch_midi,
        contour_voiced_prob,
        bool(sustain_enable_continuous_pitch_split),
        sustain_pitch_split_threshold_semitones,
        sustain_pitch_split_min_segment_seconds,
        sustain_pitch_split_min_voiced_probability,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "algorithm": "hybrid_onset_v2_basicpitch_v1_contour_split_v1",
        "durationSeconds": float(len(y) / float(sr)),
        "sampleRate": int(sr),
        "tempoBpm": tempo,
        "majorBeats": major_beats,
        "bandBeats": band_beats,
        "sustains": sustains,
        "meta": {
            "beatCount": int(len(beat_frames)),
            "majorBeatCount": int(len(major_beats)),
            "sustainCount": int(len(sustains)),
            "sustainSource": sustain_source,
            "sustainContourSplitEnabled": bool(sustain_enable_continuous_pitch_split),
            "bandCounts": {
                "low": int(len(low_peaks)),
                "mid": int(len(mid_peaks)),
                "high": int(len(high_peaks)),
                "combined": int(len(combined_peaks)),
            },
        },
    }
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def main():
    parser = argparse.ArgumentParser(description="Hybrid beat+sustain analysis")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--hop-length", type=int, default=512)
    parser.add_argument("--onset-min-strength", type=float, default=0.10)
    parser.add_argument("--onset-min-distance-seconds", type=float, default=0.11)
    parser.add_argument("--adaptive-window-seconds", type=float, default=0.45)
    parser.add_argument("--strict-k", type=float, default=1.15)
    parser.add_argument("--permissive-k", type=float, default=0.62)
    parser.add_argument("--gap-trigger-seconds", type=float, default=0.24)
    parser.add_argument("--sustain-min-duration-seconds", type=float, default=0.08)
    parser.add_argument("--sustain-merge-gap-seconds", type=float, default=0.14)
    parser.add_argument("--sustain-bridge-floor", type=float, default=0.25)
    parser.add_argument("--sustain-max-pitch-jump-semitones", type=float, default=3.0)
    parser.add_argument("--sustain-split-on-pitch-change", type=int, default=1)
    parser.add_argument("--sustain-min-pitch-confidence", type=float, default=0.45)
    parser.add_argument("--sustain-enable-continuous-pitch-split", type=int, default=1)
    parser.add_argument("--sustain-pitch-split-threshold-semitones", type=float, default=0.75)
    parser.add_argument("--sustain-pitch-split-min-segment-seconds", type=float, default=0.20)
    parser.add_argument("--sustain-pitch-split-min-voiced-probability", type=float, default=0.70)
    parser.add_argument("--low-fmin", type=float, default=20.0)
    parser.add_argument("--low-fmax", type=float, default=180.0)
    parser.add_argument("--mid-fmin", type=float, default=180.0)
    parser.add_argument("--mid-fmax", type=float, default=2200.0)
    parser.add_argument("--high-fmin", type=float, default=2200.0)
    parser.add_argument("--high-fmax", type=float, default=12000.0)
    parser.add_argument("--low-weight", type=float, default=1.15)
    parser.add_argument("--mid-weight", type=float, default=1.0)
    parser.add_argument("--high-weight", type=float, default=0.9)
    args = parser.parse_args()

    result = run_analysis(
        args.input,
        args.output,
        max(64, int(args.hop_length)),
        max(0.0, min(1.0, float(args.onset_min_strength))),
        max(0.01, float(args.onset_min_distance_seconds)),
        max(0.05, float(args.adaptive_window_seconds)),
        float(args.strict_k),
        float(args.permissive_k),
        max(0.02, float(args.gap_trigger_seconds)),
        max(0.02, float(args.sustain_min_duration_seconds)),
        max(0.0, float(args.sustain_merge_gap_seconds)),
        max(0.0, float(args.sustain_bridge_floor)),
        max(0.0, float(args.sustain_max_pitch_jump_semitones)),
        int(args.sustain_split_on_pitch_change) != 0,
        max(0.0, min(1.0, float(args.sustain_min_pitch_confidence))),
        int(args.sustain_enable_continuous_pitch_split) != 0,
        max(0.0, float(args.sustain_pitch_split_threshold_semitones)),
        max(0.02, float(args.sustain_pitch_split_min_segment_seconds)),
        max(0.0, min(1.0, float(args.sustain_pitch_split_min_voiced_probability))),
        float(args.low_fmin),
        float(args.low_fmax),
        float(args.mid_fmin),
        float(args.mid_fmax),
        float(args.high_fmin),
        float(args.high_fmax),
        float(args.low_weight),
        float(args.mid_weight),
        float(args.high_weight),
    )
    print(
        f"Hybrid analysis complete: majorBeats={result['meta']['majorBeatCount']} "
        f"sustains={result['meta']['sustainCount']} source={result['meta']['sustainSource']}"
    )


if __name__ == "__main__":
    main()
