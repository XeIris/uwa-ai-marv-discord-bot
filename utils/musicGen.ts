import {
  audioToWav,
  MIDIControllers,
  SoundBankLoader,
  SpessaSynthProcessor,
  type BasicSoundBank,
} from 'spessasynth_core';
import { log, logError } from './log';
import { GM_INSTRUMENTS, GM_DRUMS } from './gmInstruments';

/**
 * JAYDON — "Just Audio, You Dynamically Orchestrate Notes" (issue #200).
 *
 * Two chat-model tools, following the skill pattern: the model first calls
 * get_music_guide (returns data/skills/music-composition.md — the composition
 * JSON format and instrument list live there, NOT in the system prompt), then
 * calls generate_music with a composition JSON string. The composition is
 * validated against strict whitelists/caps, rendered offline with
 * spessasynth_core (pure-TS SoundFont synth) + a General MIDI soundfont, and
 * delivered as a WAV attachment on the reply webhook.
 */

export const MUSIC_GUIDE_TOOL_NAME = 'get_music_guide';
export const MUSIC_GEN_TOOL_NAME = 'generate_music';
export const MUSIC_GEN_DAILY_LIMIT = 10;
export const MUSIC_MAX_SECONDS = 30;

const MUSIC_GUIDE_PATH = `${import.meta.dir}/../data/skills/music-composition.md`;
const SOUNDFONT_PATH = process.env.MUSIC_SOUNDFONT_PATH || `${import.meta.dir}/../data/soundfonts/GeneralUser-GS.sf2`;

const SAMPLE_RATE = 44100;
const RENDER_BLOCK = 128;
/** Yield to the event loop every this many render blocks (~0.75s of audio). */
const YIELD_EVERY_BLOCKS = 256;
/** Extra render time after the last note-off so releases/reverb don't cut. */
const RELEASE_TAIL_SECONDS = 1.5;
const MAX_TITLE_CHARS = 60;
const MAX_COMPOSITION_CHARS = 60_000;
const MAX_TRACKS = 12;
const MAX_TOTAL_NOTES = 1500;
const MIN_TEMPO = 40;
const MAX_TEMPO = 250;
/** GM percussion channel (0-indexed). */
const DRUM_CHANNEL = 9;
/** Renders are CPU-bound on the shared bot process — refuse pile-ups. */
const MAX_CONCURRENT_RENDERS = 2;

const GEN_TOOL_DESCRIPTION = 'Render an original ≤30-second piece of music from a JSON composition and attach it to '
  + 'your reply as an audio file. Use ONLY when the user explicitly asks you to make/compose/generate music, a song, '
  + 'a jingle, a melody, or a beat. You MUST call get_music_guide first in this same reply — calls without it are '
  + 'rejected. The audio is attached automatically; never claim you cannot make music and never invent audio links. '
  + `Users are limited to ${MUSIC_GEN_DAILY_LIMIT} generations per 24 hours.`;

const GUIDE_TOOL_DESCRIPTION = 'Returns the JAYDON music composition guide: the exact JSON format accepted by '
  + 'generate_music, the full instrument/drum name lists, and composition tips. Call this BEFORE generate_music '
  + 'whenever the user asks for music.';

const COMPOSITION_ARG_DESCRIPTION = 'The composition as a JSON *string* in the exact format documented by '
  + 'get_music_guide (tempo, tracks, notes with time/pitch/dur/vel in beats).';

export interface MusicGenContext {
  /** Discord user id of the requester (rate-limit key). */
  userId: string;
  /** Shared Database instance (db.musicGen). */
  db: any;
}

export interface MusicGenAttachment {
  attachment: Buffer;
  name: string;
}

export type MusicGenResult =
  | { ok: true; attachment: MusicGenAttachment; resultText: string }
  | { ok: false; error: string };

export function musicToolDefs(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: MUSIC_GUIDE_TOOL_NAME,
        description: GUIDE_TOOL_DESCRIPTION,
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: MUSIC_GEN_TOOL_NAME,
        description: GEN_TOOL_DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Short title for the piece (used as the file name).',
            },
            composition: { type: 'string', description: COMPOSITION_ARG_DESCRIPTION },
          },
          required: ['composition'],
        },
      },
    },
  ];
}

export function musicGeminiDecls(): any[] {
  return [
    {
      name: MUSIC_GUIDE_TOOL_NAME,
      description: GUIDE_TOOL_DESCRIPTION,
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: MUSIC_GEN_TOOL_NAME,
      description: GEN_TOOL_DESCRIPTION,
      parameters: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING', description: 'Short title for the piece (used as the file name).' },
          composition: { type: 'STRING', description: COMPOSITION_ARG_DESCRIPTION },
        },
        required: ['composition'],
      },
    },
  ];
}

/** System-prompt note advertising the music tools (kept tiny — details live in the guide). */
export function buildMusicGenNote(musicGen?: MusicGenContext): string {
  if (!musicGen) return '';
  return `\n\nYou can compose real, playable music (up to ${MUSIC_MAX_SECONDS}s, full General MIDI instrument set). `
    + `When the user asks you to make music/a song/a beat, FIRST call ${MUSIC_GUIDE_TOOL_NAME} to learn the format, `
    + `then call ${MUSIC_GEN_TOOL_NAME}. The audio file is attached to your reply automatically — never claim you `
    + `cannot make music, and never invent audio links. Limit: ${MUSIC_GEN_DAILY_LIMIT} generations per user per 24 hours.`;
}

let cachedGuide: string | null = null;

/** The composition guide served to the model by get_music_guide. */
export async function getMusicGuide(): Promise<string> {
  if (cachedGuide !== null) return cachedGuide;
  try {
    cachedGuide = await Bun.file(MUSIC_GUIDE_PATH).text();
  } catch (err) {
    logError('[musicgen] failed to read composition guide:', err);
    return 'Error: the music composition guide is unavailable. Do not call generate_music; tell the user music generation is temporarily down.';
  }
  return cachedGuide;
}

let cachedBank: BasicSoundBank | null = null;
let bankLoadFailed = false;

async function getSoundBank(): Promise<BasicSoundBank | null> {
  if (cachedBank) return cachedBank;
  if (bankLoadFailed) return null;
  try {
    const buf = await Bun.file(SOUNDFONT_PATH).arrayBuffer();
    cachedBank = SoundBankLoader.fromArrayBuffer(buf);
    log(`[musicgen] loaded soundfont ${SOUNDFONT_PATH} (${(buf.byteLength / 1e6).toFixed(1)} MB)`);
    return cachedBank;
  } catch (err) {
    // Missing soundfont is a deployment problem; don't retry on every call.
    bankLoadFailed = true;
    logError(`[musicgen] failed to load soundfont at ${SOUNDFONT_PATH} (run: bun scripts/fetch-soundfont.ts):`, err);
    return null;
  }
}

const NOTE_NAME_RE = /^([A-Ga-g])([#b]?)(-?\d{1,2})$/;
const SEMITONES: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/** "C4" / "F#3" / "Bb5" / plain 0-127 → MIDI note number, or null when invalid. */
export function parsePitch(raw: any): number | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 0 && raw <= 127 ? raw : null;
  }
  if (typeof raw !== 'string') return null;
  const m = NOTE_NAME_RE.exec(raw.trim());
  if (!m) return null;
  const semitone = SEMITONES[m[1].toUpperCase()] + (m[2] === '#' ? 1 : 0) + (m[2] === 'b' ? -1 : 0);
  const octave = parseInt(m[3], 10);
  const note = (octave + 1) * 12 + semitone;
  return note >= 0 && note <= 127 ? note : null;
}

interface NoteEvent {
  timeSec: number;
  channel: number;
  key: number;
  velocity: number;
  durSec: number;
}

interface ParsedComposition {
  tempo: number;
  totalSeconds: number;
  noteCount: number;
  events: NoteEvent[];
  programs: { channel: number; program: number }[];
  controllers: { channel: number; controller: number; value: number }[];
  instrumentSummary: string[];
}

type ParseResult = { ok: true; comp: ParsedComposition } | { ok: false; error: string };

function clampInt(raw: any, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' ? Math.trunc(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Validates a raw composition JSON string into concrete, clamped note events.
 * Every failure returns an actionable message so the model can fix its next
 * attempt within the same tool loop.
 */
export function parseComposition(raw: any): ParseResult {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'Error: "composition" must be a non-empty JSON string. Call get_music_guide for the format.' };
  }
  if (raw.length > MAX_COMPOSITION_CHARS) {
    return { ok: false, error: `Error: composition JSON is too large (${raw.length} chars, max ${MAX_COMPOSITION_CHARS}). Use fewer notes.` };
  }
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch (err: any) {
    return { ok: false, error: `Error: composition is not valid JSON (${err?.message ?? 'parse error'}). Re-emit it as strict JSON.` };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Error: composition must be a JSON object like {"tempo":120,"tracks":[...]}.' };
  }

  const tempo = typeof data.tempo === 'number' && Number.isFinite(data.tempo) ? Math.trunc(data.tempo) : NaN;
  if (!(tempo >= MIN_TEMPO && tempo <= MAX_TEMPO)) {
    return { ok: false, error: `Error: "tempo" must be a number between ${MIN_TEMPO} and ${MAX_TEMPO} (beats per minute).` };
  }
  const secPerBeat = 60 / tempo;

  if (!Array.isArray(data.tracks) || data.tracks.length === 0) {
    return { ok: false, error: 'Error: "tracks" must be a non-empty array of {instrument, notes} objects.' };
  }
  if (data.tracks.length > MAX_TRACKS) {
    return { ok: false, error: `Error: too many tracks (${data.tracks.length}, max ${MAX_TRACKS}). Merge or drop some.` };
  }

  const events: NoteEvent[] = [];
  const programs: { channel: number; program: number }[] = [];
  const controllers: { channel: number; controller: number; value: number }[] = [];
  const instrumentSummary: string[] = [];
  let nextMelodicChannel = 0;
  let noteCount = 0;
  let maxEndSec = 0;
  const maxSongBeats = (MUSIC_MAX_SECONDS / secPerBeat) + 0.001;

  let drumsTrackSeen = false;
  for (let t = 0; t < data.tracks.length; t += 1) {
    const track = data.tracks[t];
    if (!track || typeof track !== 'object') {
      return { ok: false, error: `Error: track ${t} is not an object.` };
    }

    const instRaw = track.instrument;
    const isDrums = instRaw === 'drums';
    let channel: number;
    if (isDrums) {
      if (drumsTrackSeen) {
        return { ok: false, error: `Error: track ${t} — only one "drums" track is allowed. Merge all drum notes into a single track.` };
      }
      drumsTrackSeen = true;
      channel = DRUM_CHANNEL;
    } else {
      let program: number;
      if (typeof instRaw === 'number' && Number.isInteger(instRaw) && instRaw >= 0 && instRaw <= 127) {
        program = instRaw;
      } else if (typeof instRaw === 'string' && GM_INSTRUMENTS[instRaw] !== undefined) {
        program = GM_INSTRUMENTS[instRaw];
      } else {
        return {
          ok: false,
          error: `Error: track ${t} has unknown instrument ${JSON.stringify(instRaw)}. Use "drums", a GM program number 0-127, or an exact name from get_music_guide (e.g. "acoustic_grand_piano", "violin", "synth_bass_1").`,
        };
      }
      channel = nextMelodicChannel;
      nextMelodicChannel += 1;
      if (nextMelodicChannel === DRUM_CHANNEL) nextMelodicChannel += 1;
      if (channel > 15) {
        return { ok: false, error: 'Error: too many melodic tracks — at most 15 (plus one "drums" track).' };
      }
      programs.push({ channel, program });
    }
    instrumentSummary.push(typeof instRaw === 'string' ? instRaw : `program_${instRaw}`);

    // Optional per-track mix controls.
    if (track.volume !== undefined) {
      controllers.push({ channel, controller: MIDIControllers.mainVolume, value: clampInt(track.volume, 0, 127, 100) });
    }
    if (track.pan !== undefined) {
      controllers.push({ channel, controller: MIDIControllers.pan, value: clampInt(track.pan, 0, 127, 64) });
    }
    if (track.reverb !== undefined) {
      controllers.push({ channel, controller: MIDIControllers.reverbDepth, value: clampInt(track.reverb, 0, 127, 0) });
    }

    if (!Array.isArray(track.notes) || track.notes.length === 0) {
      return { ok: false, error: `Error: track ${t} ("${instrumentSummary[t]}") has no "notes" array.` };
    }

    for (let n = 0; n < track.notes.length; n += 1) {
      const note = track.notes[n];
      noteCount += 1;
      if (noteCount > MAX_TOTAL_NOTES) {
        return { ok: false, error: `Error: too many notes (max ${MAX_TOTAL_NOTES} total). Simplify the piece.` };
      }
      if (!note || typeof note !== 'object') {
        return { ok: false, error: `Error: track ${t} note ${n} is not an object.` };
      }

      let key: number | null;
      if (isDrums && typeof note.pitch === 'string') {
        key = GM_DRUMS[note.pitch] ?? null;
        if (key === null) {
          return { ok: false, error: `Error: track ${t} note ${n} has unknown drum ${JSON.stringify(note.pitch)}. Use names from get_music_guide (e.g. "kick", "snare", "closed_hihat") or GM key numbers 35-81.` };
        }
      } else {
        key = parsePitch(note.pitch);
        if (key === null) {
          return { ok: false, error: `Error: track ${t} note ${n} has invalid pitch ${JSON.stringify(note.pitch)}. Use note names like "C4"/"F#3"/"Bb5" or MIDI numbers 0-127.` };
        }
      }

      const time = typeof note.time === 'number' && Number.isFinite(note.time) ? note.time : NaN;
      if (!(time >= 0)) {
        return { ok: false, error: `Error: track ${t} note ${n} has invalid "time" (${JSON.stringify(note.time)}) — must be a beat number ≥ 0.` };
      }
      const dur = typeof note.dur === 'number' && Number.isFinite(note.dur) && note.dur > 0 ? note.dur : NaN;
      if (!(dur > 0)) {
        return { ok: false, error: `Error: track ${t} note ${n} has invalid "dur" (${JSON.stringify(note.dur)}) — must be a positive number of beats.` };
      }
      if (time + dur > maxSongBeats) {
        return {
          ok: false,
          error: `Error: track ${t} note ${n} ends at beat ${(time + dur).toFixed(2)}, but at ${tempo} BPM the piece must fit in ${MUSIC_MAX_SECONDS}s (${maxSongBeats.toFixed(1)} beats). Shorten the piece.`,
        };
      }
      const velocity = clampInt(note.vel, 1, 127, 96);

      const timeSec = time * secPerBeat;
      const durSec = Math.max(0.02, dur * secPerBeat);
      events.push({
        timeSec, channel, key, velocity, durSec,
      });
      maxEndSec = Math.max(maxEndSec, timeSec + durSec);
    }
  }

  return {
    ok: true,
    comp: {
      tempo,
      totalSeconds: maxEndSec,
      noteCount,
      events,
      programs,
      controllers,
      instrumentSummary,
    },
  };
}

interface TimedMidiEvent {
  timeSec: number;
  /** noteOff of a chord-mate must not cut its siblings: order offs before ons at equal time. */
  order: number;
  fire: (synth: SpessaSynthProcessor) => void;
}

/** Offline render: fresh processor per call, shared parsed sound bank. */
async function renderComposition(comp: ParsedComposition): Promise<Buffer | null> {
  const bank = await getSoundBank();
  if (!bank) return null;

  const synth = new SpessaSynthProcessor(SAMPLE_RATE, { eventsEnabled: false });
  synth.soundBankManager.addSoundBank(bank, 'main');
  await synth.processorInitialized;

  for (const p of comp.programs) synth.programChange(p.channel, p.program);
  for (const c of comp.controllers) synth.controllerChange(c.channel, c.controller as any, c.value);

  const timeline: TimedMidiEvent[] = [];
  for (const ev of comp.events) {
    timeline.push({ timeSec: ev.timeSec, order: 1, fire: (s) => s.noteOn(ev.channel, ev.key, ev.velocity) });
    timeline.push({ timeSec: ev.timeSec + ev.durSec, order: 0, fire: (s) => s.noteOff(ev.channel, ev.key) });
  }
  timeline.sort((a, b) => (a.timeSec - b.timeSec) || (a.order - b.order));

  const renderSeconds = Math.min(comp.totalSeconds, MUSIC_MAX_SECONDS) + RELEASE_TAIL_SECONDS;
  const totalSamples = Math.ceil(SAMPLE_RATE * renderSeconds);
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  let filled = 0;
  let evIdx = 0;
  let blocksSinceYield = 0;
  while (filled < totalSamples) {
    const now = filled / SAMPLE_RATE;
    while (evIdx < timeline.length && timeline[evIdx].timeSec <= now) {
      timeline[evIdx].fire(synth);
      evIdx += 1;
    }
    const n = Math.min(RENDER_BLOCK, totalSamples - filled);
    synth.process(left, right, filled, n);
    filled += n;
    // The render is CPU-bound on the shared bot process — yield to the event
    // loop every ~0.75s of audio (~20ms of work) so Discord events keep flowing.
    blocksSinceYield += 1;
    if (blocksSinceYield >= YIELD_EVERY_BLOCKS) {
      blocksSinceYield = 0;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setImmediate(resolve); });
    }
  }

  // Peak-normalize: dense arrangements clip 16-bit WAV otherwise.
  let peak = 0;
  for (let i = 0; i < totalSamples; i += 1) {
    const a = Math.abs(left[i]);
    const b = Math.abs(right[i]);
    if (a > peak) peak = a;
    if (b > peak) peak = b;
  }
  if (peak > 0.98) {
    const scale = 0.95 / peak;
    for (let i = 0; i < totalSamples; i += 1) {
      left[i] *= scale;
      right[i] *= scale;
    }
  }
  if (peak === 0) return null; // silent output means nothing rendered

  return Buffer.from(audioToWav([left, right], SAMPLE_RATE));
}

function sanitizeTitle(raw: any): string {
  const cleaned = typeof raw === 'string'
    ? raw.trim().replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_').slice(0, MAX_TITLE_CHARS)
    : '';
  return cleaned || 'jaydon_track';
}

let inFlightRenders = 0;

export async function runMusicGeneration(opts: {
  ctx: MusicGenContext;
  args: Record<string, any>;
  /** Whether get_music_guide was called earlier in this same tool loop. */
  guideWasRead: boolean;
}): Promise<MusicGenResult> {
  const { ctx, args, guideWasRead } = opts;

  if (!guideWasRead) {
    return {
      ok: false,
      error: `Error: you must call ${MUSIC_GUIDE_TOOL_NAME} before ${MUSIC_GEN_TOOL_NAME} so the composition follows the documented format. Call it now, then retry.`,
    };
  }

  const parsed = parseComposition(args?.composition);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { comp } = parsed;

  if (inFlightRenders >= MAX_CONCURRENT_RENDERS) {
    return { ok: false, error: 'Error: too many music renders in flight right now. Tell the user to try again in a moment.' };
  }
  // Claim the slot synchronously — no await between the guard and this line,
  // so concurrent tool calls cannot all pass the check before it takes effect.
  inFlightRenders += 1;

  const title = sanitizeTitle(args?.title);
  let wav: Buffer | null = null;
  try {
    // Atomically count + insert the quota row (fail closed: DB errors block generation).
    let reservationId: number | null = null;
    try {
      reservationId = await ctx.db.musicGen.reserveGeneration(ctx.userId, title, MUSIC_GEN_DAILY_LIMIT);
    } catch (err) {
      logError('[musicgen] quota reservation failed:', err);
      return { ok: false, error: 'Error: music generation is temporarily unavailable.' };
    }
    if (reservationId === null) {
      return {
        ok: false,
        error: `Error: this user has reached the music generation limit (${MUSIC_GEN_DAILY_LIMIT} per 24 hours). Tell them to try again later.`,
      };
    }
    const reservedId = reservationId;
    const releaseQuota = async () => {
      await ctx.db.musicGen.markFailed(reservedId).catch((err: any) => {
        logError('[musicgen] failed to release quota slot:', err);
      });
    };

    log(`[musicgen] user ${ctx.userId} rendering "${title}": ${comp.noteCount} notes, `
      + `${comp.instrumentSummary.length} track(s) [${comp.instrumentSummary.join(', ')}], `
      + `${comp.totalSeconds.toFixed(1)}s @ ${comp.tempo} BPM`);

    try {
      wav = await renderComposition(comp);
    } catch (err) {
      logError('[musicgen] render failed:', err);
      await releaseQuota();
      return { ok: false, error: 'Error: music rendering failed. Tell the user to try again later.' };
    }

    if (!wav) {
      await releaseQuota();
      return { ok: false, error: 'Error: music generation is unavailable or produced silence. Tell the user to try again later.' };
    }

    return {
      ok: true,
      attachment: { attachment: wav, name: `${title}.wav` },
      resultText: `Music generated successfully: "${title}" — ${comp.totalSeconds.toFixed(1)}s at ${comp.tempo} BPM, `
        + `${comp.noteCount} notes across ${comp.instrumentSummary.length} track(s) (${comp.instrumentSummary.join(', ')}). `
        + 'The audio file is attached to your reply automatically — do not write a link or placeholder for it; just '
        + 'describe the piece briefly.',
    };
  } finally {
    inFlightRenders -= 1;
  }
}
