# Distinct Multi-Source Expansion Plan (2026-03-23)

## Research findings (what supports “as many distinct sources as possible”)
1. Demucs v4 supports a 6-source model (`htdemucs_6s`) with named stems: `drums`, `bass`, `vocals`, `other`, `guitar`, `piano`.
2. Spleeter provides 2/4/5 stem variants (named stems, especially useful for an additional `piano` split in some material).
3. Open-Unmix provides 4 stems (`vocals`, `drums`, `bass`, `other`) and can be used as a fallback baseline.
4. Librosa + NMF supports decomposition of spectrograms into arbitrary component counts (`S ~= W*H`) and HPSS supports harmonic/percussive splitting.

Implication:
- No open model guarantees “all instruments separated by name” for arbitrary songs.
- Best practical approach is:
  1) maximize named stems with SOTA separator,
  2) recursively split remaining mixed stems into additional unlabeled components,
  3) assign incremental source labels for unlabeled components.

## Target behavior
- Extract as many distinct sources as feasible from each song.
- Known source names stay named when available.
- Additional discovered sources are labeled `source_01`, `source_02`, ...
- Chart and playback show all sources as separate colored sustained lanes.

## Implementation architecture

### A) Backend source-separation service (new Python module)
1. Primary separator:
- Run Demucs `htdemucs_6s` when available.
- Output named stems: drums/bass/vocals/guitar/piano/other.

2. Optional secondary separator:
- If configured, run Spleeter 5-stem on mixture or on `other` to extract additional named candidates.

3. Residual discovery stage (unlabeled source expansion):
- For each still-mixed stem (especially `other`), run iterative decomposition:
  - HPSS split
  - NMF decomposition on spectrogram into K components
  - convert components to waveforms
- Keep components that pass energy/distinctness thresholds.
- Label surviving unlabeled components as `source_XX`.

4. Distinctness filtering:
- Remove near-duplicate components by correlation/energy overlap.
- Cap tiny/noisy components below minimum RMS/coverage.

### B) Event extraction per source
- Reuse existing sustain/event extraction per source waveform.
- Produce events tagged with source label (named or `source_XX`).

### C) Frontend rendering updates
1. Dynamic source lanes:
- No fixed source list.
- Build lanes from all sources present in extracted/saved data.

2. Color system:
- Stable color generation per source label (hash -> color).
- Named sources can keep preferred palette; unknown sources get deterministic generated colors.

3. Sustain rendering:
- Keep elongated segments by sustain start/end for every source lane.
- Playback highlights active segments in real time for all lanes.

### D) Save/load schema
- Persist full source list and source events in JSON.
- Keep backward compatibility with previous saves.

## Runtime config additions
- `SEPARATION_BACKEND` (`demucs` default)
- `SEPARATION_MAX_UNLABELED_SOURCES`
- `SEPARATION_MIN_SOURCE_ENERGY`
- `SEPARATION_NMF_COMPONENTS`
- `SEPARATION_ENABLE_SPLEETER_FUSION`

## Delivery phases
1. Dynamic source-lane UI + deterministic per-source colors (works with current extractor and any source labels).
2. Backend Demucs integration for named multi-source stems.
3. Unlabeled source expansion via NMF/HPSS and `source_XX` labeling.
4. End-to-end save/playback validation and performance tuning.

## Validation criteria
- Single run can produce > current fixed source set on complex songs.
- Chart displays each source separately with unique color.
- Playback highlights all source events in sync.
- `docker compose up --build` still works.

## Primary sources
- Demucs repo/README (model list incl. `htdemucs_6s`): https://github.com/facebookresearch/demucs
- Spleeter repo (2/4/5 stems): https://github.com/deezer/spleeter
- Open-Unmix docs (4 stems): https://sigsep.github.io/open-unmix/
- Librosa NMF decomposition: https://librosa.org/doc/0.11.0/generated/librosa.decompose.decompose.html
- Librosa HPSS: https://librosa.org/doc/main/generated/librosa.effects.hpss.html
- Scikit-learn NMF: https://scikit-learn.org/1.5/modules/generated/sklearn.decomposition.NMF.html
- MDX challenge context: https://www.frontiersin.org/journals/signal-processing/articles/10.3389/frsip.2021.808395/full
