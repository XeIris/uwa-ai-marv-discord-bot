import { describe, test, expect } from 'bun:test';
import { parsePitch, parseComposition } from '../../utils/musicGen';
import { GM_INSTRUMENTS, GM_DRUMS } from '../../utils/gmInstruments';

const validComposition = (overrides: Record<string, any> = {}) => JSON.stringify({
  tempo: 120,
  tracks: [
    {
      instrument: 'acoustic_grand_piano',
      notes: [
        {
          time: 0, pitch: 'C4', dur: 1, vel: 90,
        },
        {
          time: 1, pitch: 64, dur: 0.5, vel: 80,
        },
      ],
    },
    {
      instrument: 'drums',
      notes: [{
        time: 0, pitch: 'kick', dur: 0.1, vel: 110,
      }],
    },
  ],
  ...overrides,
});

describe('parsePitch', () => {
  test('parses note names', () => {
    expect(parsePitch('C4')).toBe(60);
    expect(parsePitch('A4')).toBe(69);
    expect(parsePitch('F#3')).toBe(54);
    expect(parsePitch('Bb5')).toBe(82);
    expect(parsePitch('c-1')).toBe(0);
    expect(parsePitch('G9')).toBe(127);
  });

  test('accepts valid MIDI numbers and rejects out-of-range', () => {
    expect(parsePitch(0)).toBe(0);
    expect(parsePitch(127)).toBe(127);
    expect(parsePitch(128)).toBeNull();
    expect(parsePitch(-1)).toBeNull();
    expect(parsePitch(60.5)).toBeNull();
  });

  test('rejects garbage', () => {
    expect(parsePitch('H4')).toBeNull();
    expect(parsePitch('C')).toBeNull();
    expect(parsePitch('')).toBeNull();
    expect(parsePitch(null)).toBeNull();
    expect(parsePitch({})).toBeNull();
    expect(parsePitch('C10')).toBeNull(); // above 127
  });
});

describe('GM maps', () => {
  test('instrument map covers all 128 GM programs', () => {
    const programs = Object.values(GM_INSTRUMENTS).sort((a, b) => a - b);
    expect(programs.length).toBe(128);
    expect(new Set(programs).size).toBe(128);
    expect(programs[0]).toBe(0);
    expect(programs[127]).toBe(127);
  });

  test('drum map stays within GM percussion range', () => {
    for (const key of Object.values(GM_DRUMS)) {
      expect(key).toBeGreaterThanOrEqual(35);
      expect(key).toBeLessThanOrEqual(81);
    }
    expect(GM_DRUMS.kick).toBe(36);
    expect(GM_DRUMS.snare).toBe(38);
  });
});

describe('parseComposition', () => {
  test('accepts a valid composition', () => {
    const res = parseComposition(validComposition());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.comp.tempo).toBe(120);
    expect(res.comp.noteCount).toBe(3);
    expect(res.comp.events.length).toBe(3);
    expect(res.comp.programs).toEqual([{ channel: 0, program: 0 }]);
    // drums go to channel 9
    const drumEvent = res.comp.events.find((e) => e.key === 36);
    expect(drumEvent?.channel).toBe(9);
    // beat → seconds at 120 BPM
    const second = res.comp.events.find((e) => e.key === 64);
    expect(second?.timeSec).toBeCloseTo(0.5);
    expect(second?.durSec).toBeCloseTo(0.25);
  });

  test('rejects non-JSON, wrong shapes, and empty input', () => {
    expect(parseComposition(undefined).ok).toBe(false);
    expect(parseComposition('').ok).toBe(false);
    expect(parseComposition('not json{').ok).toBe(false);
    expect(parseComposition('[]').ok).toBe(false);
    expect(parseComposition('{"tempo":120}').ok).toBe(false);
    expect(parseComposition('{"tempo":120,"tracks":[]}').ok).toBe(false);
  });

  test('rejects bad tempo', () => {
    for (const tempo of [0, 39, 251, 'fast', null]) {
      const res = parseComposition(validComposition({ tempo }));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain('tempo');
    }
  });

  test('rejects unknown instruments with an actionable error', () => {
    const res = parseComposition(JSON.stringify({
      tempo: 120,
      tracks: [{ instrument: 'guitar', notes: [{ time: 0, pitch: 'C4', dur: 1 }] }],
    }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('unknown instrument');
  });

  test('accepts GM program numbers as instruments', () => {
    const res = parseComposition(JSON.stringify({
      tempo: 120,
      tracks: [{ instrument: 40, notes: [{ time: 0, pitch: 'C4', dur: 1 }] }],
    }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.comp.programs).toEqual([{ channel: 0, program: 40 }]);
  });

  test('rejects a second drums track', () => {
    const res = parseComposition(JSON.stringify({
      tempo: 120,
      tracks: [
        { instrument: 'drums', notes: [{ time: 0, pitch: 'kick', dur: 0.1 }] },
        { instrument: 'drums', notes: [{ time: 1, pitch: 'snare', dur: 0.1 }] },
      ],
    }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('only one "drums" track');
  });

  test('rejects unknown drum names', () => {
    const res = parseComposition(JSON.stringify({
      tempo: 120,
      tracks: [{ instrument: 'drums', notes: [{ time: 0, pitch: 'boom', dur: 1 }] }],
    }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('unknown drum');
  });

  test('enforces the 30-second cap at the chosen tempo', () => {
    // 61 beats at 120 BPM = 30.5s > 30s
    const res = parseComposition(JSON.stringify({
      tempo: 120,
      tracks: [{ instrument: 'violin', notes: [{ time: 60, pitch: 'C4', dur: 1 }] }],
    }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('30');

    // exactly at the edge: 60 beats at 120 BPM = 30s
    const edge = parseComposition(JSON.stringify({
      tempo: 120,
      tracks: [{ instrument: 'violin', notes: [{ time: 59, pitch: 'C4', dur: 1 }] }],
    }));
    expect(edge.ok).toBe(true);
  });

  test('rejects negative time / non-positive duration / NaN smuggling', () => {
    const bad = [
      { time: -1, pitch: 'C4', dur: 1 },
      { time: 0, pitch: 'C4', dur: 0 },
      { time: 0, pitch: 'C4', dur: -2 },
      { time: 'now', pitch: 'C4', dur: 1 },
      { time: 0, pitch: 'C4' },
    ];
    for (const note of bad) {
      const res = parseComposition(JSON.stringify({
        tempo: 120,
        tracks: [{ instrument: 'violin', notes: [note] }],
      }));
      expect(res.ok).toBe(false);
    }
  });

  test('clamps velocity into 1-127 with default 96', () => {
    const res = parseComposition(JSON.stringify({
      tempo: 120,
      tracks: [{
        instrument: 'violin',
        notes: [
          {
            time: 0, pitch: 'C4', dur: 1, vel: 900,
          },
          {
            time: 1, pitch: 'C4', dur: 1, vel: -5,
          },
          { time: 2, pitch: 'C4', dur: 1 },
        ],
      }],
    }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.comp.events[0].velocity).toBe(127);
    expect(res.comp.events[1].velocity).toBe(1);
    expect(res.comp.events[2].velocity).toBe(96);
  });

  test('enforces track and note caps', () => {
    const manyTracks = {
      tempo: 120,
      tracks: Array.from({ length: 13 }, () => ({
        instrument: 'violin',
        notes: [{ time: 0, pitch: 'C4', dur: 1 }],
      })),
    };
    expect(parseComposition(JSON.stringify(manyTracks)).ok).toBe(false);

    const manyNotes = {
      tempo: 240,
      tracks: [{
        instrument: 'violin',
        notes: Array.from({ length: 1501 }, (_, i) => ({ time: (i % 100) * 0.1, pitch: 'C4', dur: 0.1 })),
      }],
    };
    expect(parseComposition(JSON.stringify(manyNotes)).ok).toBe(false);
  });

  test('melodic channel assignment skips the drum channel', () => {
    const res = parseComposition(JSON.stringify({
      tempo: 120,
      tracks: Array.from({ length: 11 }, () => ({
        instrument: 'violin',
        notes: [{ time: 0, pitch: 'C4', dur: 1 }],
      })),
    }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const channels = res.comp.programs.map((p) => p.channel);
    expect(channels).not.toContain(9);
    expect(channels.length).toBe(11);
    expect(new Set(channels).size).toBe(11);
  });
});
