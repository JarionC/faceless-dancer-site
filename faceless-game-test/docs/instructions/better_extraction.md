## DISCUSSION

For a **full modern song** — drums, vocals, bass, synths, chords, FX, layered production — the clean way to think about this is:

You do **not** want one library to do everything.

You want a pipeline where each tool does one job well:

1. **split the mixed song into stems**
2. **extract note events from pitched material**
3. **extract drum hits from percussion**
4. **extract beat / tempo / downbeats for grid alignment**
5. **post-process into game lanes and sustains**

The best practical architecture is:

## Recommended pipeline

### 1) Stem separation

Use **Demucs** first.

What Demucs gives you:

* separated audio stems from the mixed song
* commonly:

  * `drums`
  * `bass`
  * `vocals`
  * `other`

What this data is:

* actual audio files per stem
* not note events
* not beat timestamps
* not sustains
* just cleaner isolated sources so later tools have a better shot

Why this matters:

* modern songs are too dense to transcribe directly from the full mix
* vocals, drums, bass, synths, sidechains, pads, FX all interfere with each other
* separation is what makes later note and rhythm detection usable at all

For a rhythm game, this is the first major split of your chart universe:

* drum lanes mostly come from `drums`
* bass lanes mostly come from `bass`
* melodic/chord lanes mostly come from `other`
* vocal gameplay, if any, comes from `vocals`

## 2) Pitched note extraction with sustains

Use **Basic Pitch** on the non-drum stems.

Best targets:

* `bass`
* `other`
* sometimes `vocals`

What Basic Pitch gives you:

* note start times
* note end times
* pitch values
* note confidence / salience-like strength info
* MIDI-like note events

What this data is:

* **onset** = when the note begins
* **offset** = when the note ends
* **duration** = sustain length
* **pitch** = which note it is
* **confidence** = how likely the model thinks the note is real

This is where your **sustains** come from.

For rhythm-game purposes:

* tap note = short duration event
* sustain note = long duration event
* lane placement can be based on stem, pitch range, or note role

Example of what Basic Pitch-style output means in your system:

```json
{
  "source": "bass",
  "pitch": 43,
  "start": 12.384,
  "end": 13.127,
  "duration": 0.743,
  "confidence": 0.81
}
```

That is already much closer to a chart note than anything beat tracking gives you.

## 3) Drum event extraction

For drums, plain note transcription is usually not enough.

Why:

* drums are not just “notes”
* you often want **classed hits**
* rhythm games usually care about:

  * kick
  * snare
  * hi-hat / cymbal
  * tom / clap / percussion
* drum gameplay is more about **which drum hit occurred when**, not about musical pitch sustain

So for `drums`, you want **drum transcription** or at least strong onset detection.

### Best drum data to target

You want output like:

```json
{
  "source": "drums",
  "class": "snare",
  "time": 24.512,
  "strength": 0.88
}
```

This is different from pitched note data.

### Omnizart route

A good library direction here is **Omnizart**, because it is designed around automatic music transcription and includes separate handling for things like:

* music notes
* drums
* vocals
* chords
* beat-related tasks

For your use case, its value is that it is closer to a **multi-task MIR toolkit** than a single-purpose beat detector.

What you want from the drum side:

* hit timestamps
* drum class labels
* optionally confidence
* optionally very short duration placeholders for non-sustain percussion notes

For drum lanes:

* kick -> lane 1
* snare/clap -> lane 2
* hats/cymbals -> lane 3
* extra perc/toms -> lane 4 or overflow lane

## 4) Beat and tempo grid

Use **madmom** for tempo/beat/downbeat alignment.

This is where madmom *does* shine.

What madmom gives you:

* beat activation over time
* beat timestamps
* often very good beat tracking on musical audio
* useful timing grid for quantization and chart cleanup

What this data is:

* global pulse timing
* not instrument separation
* not sustains
* not note classes

So madmom’s role in your rhythm-game pipeline should be:

* find beat positions
* estimate tempo consistency
* optionally find downbeats / bar structure
* provide the chart grid for snapping notes

Example output meaning:

```json
{
  "beat": 31.500,
  "strength": 0.74
}
```

That helps you decide whether a detected note belongs near:

* 1/4 note
* 1/8 note
* triplet
* syncopated off-grid event

So madmom is your **timing skeleton**, not your lane detector.

## 5) Optional onset/energy analysis

Sometimes you also want a raw transient detector, especially for:

* dense percussion
* noisy dance tracks
* sidechained EDM attacks
* FX accents
* things transcription misses

That’s where onset-strength style analysis helps.

This kind of data gives:

* a timestamped “attack strength” curve
* transient peaks
* rough event intensity

This is useful for:

* filling missed drum hits
* measuring note impact
* deciding whether weak transcribed notes should be pruned
* ranking events by playability

It is not enough by itself for sustains, but it is good as a support signal.

## What comes from what

Here is the clean breakdown.

### Demucs

Produces:

* separated audio stems

Data returned:

* `drums.wav`
* `bass.wav`
* `vocals.wav`
* `other.wav`

Use for:

* isolating sources before any game-note extraction

Does **not** directly produce:

* note timestamps
* sustains
* beat grid
* classes

---

### Basic Pitch

Produces:

* note events for pitched material

Data returned:

* onset time
* offset time
* duration
* pitch
* confidence
* MIDI-like note structure

Use for:

* bass sustains
* synth sustains
* chord/melody sustains
* possibly vocal phrase notes if you want vocal lanes

Does **not** do best on:

* mixed full songs without separation
* drum-class gameplay

---

### Omnizart

Produces:

* transcription-oriented outputs for multiple musical tasks

Data you may use from it:

* drum hit events and classes
* music note events
* vocal-related events
* chord-related analysis
* beat-related analysis, depending on which module you use

Use for:

* drum classification
* richer music-information extraction than plain beat tracking
* potentially a more unified research-heavy pipeline

Tradeoff:

* more complex
* more “music information retrieval lab toolkit” energy
* not as lightweight/simple as a narrow-purpose script

---

### madmom

Produces:

* beat activation curves
* beat timestamps
* timing grid information

Use for:

* tempo / beat alignment
* quantization grid
* measure/downbeat structure support
* post-process snapping and chart timing cleanup

Does **not** produce:

* stem separation
* instrument labels
* note durations
* sustains

---

### onset / energy analysis tools

Produces:

* transient peaks
* event-strength estimates
* rough rhythmic attack timing

Use for:

* reinforcing percussion detection
* attack strength scoring
* cleanup heuristics

Does **not** produce:

* clean sustain lengths by itself

## How this fits modern songs

For a modern dance song or pop song, you usually have all of these at once:

* kick
* snare/clap
* hats/shakers
* bass
* leads
* pads/chords
* vocals
* risers, impacts, FX
* sidechain pumping
* layered transient masking

That means one “detect beats from the song” model is nowhere near enough.

You need to treat the song as several overlapping gameplay sources:

### drums stem

Best for:

* kick/snare/hat lanes
* dense rhythmic tap patterns
* burst sections
* fills

Expected note style:

* mostly taps
* maybe occasional very short holds if your design wants roll-lanes or cymbal holds

### bass stem

Best for:

* strong sustained notes
* pulse notes
* groove anchors

Expected note style:

* excellent source of sustains
* easy lane assignment by pitch or energy

### other stem

Best for:

* synth leads
* stabs
* chords
* melodic hooks

Expected note style:

* lots of sustains
* lots of false positives unless pruned
* good for higher lanes or “harmony” lanes

### vocals stem

Best for:

* vocal phrase gameplay
* lyric-follow events
* melody sustain lanes

Expected note style:

* can be noisy
* may need more smoothing and phrase merging

## What I would actually build

For a usable first version, I would do this:

### Version 1

* **Demucs** separates song
* **Basic Pitch** on `bass`, `other`, maybe `vocals`
* **drum transcription or onset detection** on `drums`
* **madmom** on the full song for beat/downbeat grid
* merge into one event list
* quantize softly to the grid
* prune junk
* export game JSON

### Resulting JSON concept

```json
{
  "tempo_map": [
    { "time": 0.0, "bpm": 128.0 }
  ],
  "beats": [
    { "time": 0.469, "strength": 0.77 }
  ],
  "notes": [
    {
      "lane": 1,
      "source": "drums",
      "class": "kick",
      "start": 12.000,
      "end": 12.000,
      "duration": 0.0,
      "strength": 0.92
    },
    {
      "lane": 4,
      "source": "bass",
      "pitch": 43,
      "start": 12.384,
      "end": 13.127,
      "duration": 0.743,
      "strength": 0.81
    },
    {
      "lane": 6,
      "source": "other",
      "pitch": 67,
      "start": 14.250,
      "end": 15.000,
      "duration": 0.750,
      "strength": 0.74
    }
  ]
}
```

## Lane assignment strategy

You asked for songs with lots of varied content, so lane design matters as much as extraction.

A sane first-pass mapping:

* lane 1: kick / low perc
* lane 2: snare / clap
* lane 3: hats / cymbals / high perc
* lane 4: bass
* lane 5: low-mid harmony
* lane 6: high melody / lead
* lane 7: vocals or special accents

Then use rules like:

* long duration from Basic Pitch -> sustain
* short duration from Basic Pitch -> tap
* drum class determines fixed drum lane
* vocal phrase notes either become dedicated lanes or are ignored

## Reality check

For **full commercial-style songs**, automatic extraction will never be perfectly clean.

You will get:

* stem bleed
* duplicate note hallucinations
* split sustained notes into fragments
* extra notes from reverb or chorus
* missed drum classes in dense sections
* vocal/pad confusion in `other`

So you should expect a cleanup stage:

* min duration threshold
* merge adjacent same-pitch notes
* remove weak notes
* cap note density per lane
* snap to beat grid with tolerance, not hard forcing
* optionally phrase-detect vocals and merge long held notes

That cleanup stage is not optional if you want playable charts.

## My recommendation

For your exact use case:

**Use a layered system, not a single detector.**

Best practical stack:

* **Demucs** for source separation
* **Basic Pitch** for sustained pitched notes
* **drum transcription / onset detection** for drum lanes
* **madmom** for beat grid and chart timing

That is the correct shape for:

* modern songs
* multiple instruments
* vocals
* drum separation
* visible sustains
* rhythm-game lanes

One note: I tried to verify the latest docs live before answering, but browsing is temporarily unavailable in this session, so this is based on my best current understanding of these libraries and how they’re typically used together. The overall architecture is still the right one.
