# JAYDON music composition guide

You are about to compose real audio. Write a composition JSON, then pass it to `generate_music` as the `composition` argument (a JSON **string**), with a short `title`. The piece must fit in **30 seconds**.

## Format

```json
{
  "tempo": 120,
  "tracks": [
    {
      "instrument": "acoustic_grand_piano",
      "volume": 100,
      "pan": 64,
      "reverb": 40,
      "notes": [
        { "time": 0, "pitch": "C4", "dur": 1, "vel": 90 },
        { "time": 1, "pitch": 64, "dur": 0.5, "vel": 80 }
      ]
    },
    {
      "instrument": "drums",
      "notes": [ { "time": 0, "pitch": "kick", "dur": 0.1, "vel": 110 } ]
    }
  ]
}
```

- `tempo`: BPM, 40–250. All times/durations are in **beats** (at 120 BPM, 1 beat = 0.5s; 30s = 60 beats).
- `tracks`: max 12 (max one `"drums"` track). Each track = one instrument.
- `instrument`: an exact name from the list below, a GM program number 0–127, or `"drums"`.
- `notes`: `time` = start beat (≥0), `dur` = length in beats (>0), `vel` = velocity/loudness 1–127 (default 96), `pitch` = note name (`"C4"`, `"F#3"`, `"Bb5"`; C4 = middle C = 60) or MIDI number 0–127. For drums, `pitch` is a drum name or GM key 35–81.
- Optional per track: `volume` 0–127, `pan` 0(L)–64(C)–127(R), `reverb` 0–127.
- Hard caps: 1500 notes total; every `time + dur` must fit inside 30 seconds at the chosen tempo.

## Instruments (exact names)

**Piano/keys:** acoustic_grand_piano, bright_acoustic_piano, electric_grand_piano, honky_tonk_piano, electric_piano_1, electric_piano_2, harpsichord, clavinet
**Chromatic:** celesta, glockenspiel, music_box, vibraphone, marimba, xylophone, tubular_bells, dulcimer
**Organ:** drawbar_organ, percussive_organ, rock_organ, church_organ, reed_organ, accordion, harmonica, tango_accordion
**Guitar:** nylon_guitar, steel_guitar, jazz_guitar, clean_electric_guitar, muted_electric_guitar, overdriven_guitar, distortion_guitar, guitar_harmonics
**Bass:** acoustic_bass, fingered_bass, picked_bass, fretless_bass, slap_bass_1, slap_bass_2, synth_bass_1, synth_bass_2
**Strings:** violin, viola, cello, contrabass, tremolo_strings, pizzicato_strings, orchestral_harp, timpani
**Ensemble:** string_ensemble_1, string_ensemble_2, synth_strings_1, synth_strings_2, choir_aahs, voice_oohs, synth_voice, orchestra_hit
**Brass:** trumpet, trombone, tuba, muted_trumpet, french_horn, brass_section, synth_brass_1, synth_brass_2
**Reed:** soprano_sax, alto_sax, tenor_sax, baritone_sax, oboe, english_horn, bassoon, clarinet
**Pipe:** piccolo, flute, recorder, pan_flute, blown_bottle, shakuhachi, whistle, ocarina
**Synth lead:** square_lead, sawtooth_lead, calliope_lead, chiff_lead, charang_lead, voice_lead, fifths_lead, bass_and_lead
**Synth pad:** new_age_pad, warm_pad, polysynth_pad, choir_pad, bowed_pad, metallic_pad, halo_pad, sweep_pad
**Synth FX:** rain_fx, soundtrack_fx, crystal_fx, atmosphere_fx, brightness_fx, goblins_fx, echoes_fx, sci_fi_fx
**Ethnic:** sitar, banjo, shamisen, koto, kalimba, bagpipe, fiddle, shanai
**Percussive:** tinkle_bell, agogo, steel_drums, woodblock, taiko_drum, melodic_tom, synth_drum, reverse_cymbal
**FX:** guitar_fret_noise, breath_noise, seashore, bird_tweet, telephone_ring, helicopter, applause, gunshot

## Drum names (for the "drums" track)

kick, kick_2, snare, snare_2, side_stick, clap, closed_hihat, pedal_hihat, open_hihat, crash, crash_2, splash_cymbal, china_cymbal, ride, ride_2, ride_bell, high_tom, high_mid_tom, low_mid_tom, low_tom, high_floor_tom, low_floor_tom, tambourine, cowbell, vibraslap, high_bongo, low_bongo, mute_high_conga, open_high_conga, low_conga, high_timbale, low_timbale, high_agogo, low_agogo, cabasa, maracas, short_whistle, long_whistle, short_guiro, long_guiro, claves, high_woodblock, low_woodblock, mute_cuica, open_cuica, mute_triangle, open_triangle

## Composition tips (make it sound good)

1. **Use the time budget**: aim for 20–30 seconds of music. A 6-second fragment feels broken, not minimal — if your piece is short, repeat the theme with variation until it fills at least ~15s.
2. **Structure**: even a 20s piece wants shape — e.g. 4 bars intro/theme, 4 bars variation, 2 bars ending. Repeat with a twist rather than never repeating.
3. **Layers**: 3–5 tracks usually beats 10. A classic combo: melody + chords (piano/pad) + bass + drums.
4. **Bass** plays roots/fifths of the chords, one to two octaves below the melody (octave 2–3).
5. **Chords**: give harmonies long durations (2–4 beats) and lower velocity (60–85) so the melody (90–115) sits on top. Stagger chord notes by 0.02–0.05 beats for a natural feel.
6. **Drums**: kick on beats 1 and 3, snare on 2 and 4, closed_hihat on eighths (every 0.5 beats) is a solid default; add a crash on section starts and a fill (toms) into section changes.
7. **Velocity dynamics**: vary vel between notes (±10–20) — constant velocity sounds robotic. Accent downbeats.
8. **Endings**: land on the tonic with a long final chord + crash, and let it ring (the renderer adds a short release tail).
9. **Keys/register**: melody around octave 4–5 (C4–C6). Avoid extreme registers unless intentional.
10. Use `pan` to separate layers (e.g. piano 44, strings 84) and `reverb` 30–60 for pads/strings.
11. Check your math: at your tempo, does the final `time + dur` fit 30 seconds? If rejected, cut bars, don't cram.

Compose the full piece in one go, then call `generate_music`. If it returns an error, fix exactly what the error says and retry once.
