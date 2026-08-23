import { describe, expect, test } from 'bun:test';
import {
  buildModerationUserContent,
  generatedImagePart,
  parseModerationOutput,
  selectModerationImages,
} from '../../utils/aiModeration';
import { MAX_IMAGES } from '../../utils/aiMedia';
import { GLOBAL_CONFIG_KEYS, validateGlobalConfigValue } from '../../utils/globalConfig';

const img = (name: string) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${name}` } });

// The four strings below are verbatim responses from
// nvidia/nemotron-3.5-content-safety:free, captured against OpenRouter.
describe('parseModerationOutput', () => {
  test('user-only screen, benign — no Response Safety line', () => {
    expect(parseModerationOutput('User Safety: safe')).toEqual({ safe: true });
  });

  test('full exchange, benign', () => {
    expect(parseModerationOutput('User Safety: safe\nResponse Safety: safe')).toEqual({ safe: true });
  });

  test('user-only screen, unsafe', () => {
    expect(parseModerationOutput(
      'User Safety: unsafe\nSafety Categories: Guns and Illegal Weapons, Criminal Planning/Confessions',
    )).toEqual({
      safe: false,
      flaggedSide: 'user',
      categories: 'Guns and Illegal Weapons, Criminal Planning/Confessions',
    });
  });

  test('full exchange, unsafe on both sides — reports the user side', () => {
    expect(parseModerationOutput(
      'User Safety: unsafe\nResponse Safety: unsafe\nSafety Categories: Harassment, Criminal Planning/Confessions, Violence',
    )).toEqual({
      safe: false,
      flaggedSide: 'user',
      categories: 'Harassment, Criminal Planning/Confessions, Violence',
    });
  });

  test('safe prompt with an unsafe reply is attributed to the response', () => {
    expect(parseModerationOutput('User Safety: safe\nResponse Safety: unsafe\nSafety Categories: Violence')).toEqual({
      safe: false,
      flaggedSide: 'response',
      categories: 'Violence',
    });
  });

  test('strips a reasoning-mode <think> block before reading labels', () => {
    expect(parseModerationOutput(
      '<think>The user is asking about weapons. User Safety: safe is wrong here.</think>\nUser Safety: unsafe',
    )).toEqual({ safe: false, flaggedSide: 'user', categories: undefined });
  });

  test('handles a dangling </think> with no opening tag', () => {
    // Some models emit only the closer because the opener is in the chat
    // template. Everything before it is reasoning that may quote a label.
    expect(parseModerationOutput(
      'The user asks about knives. User Safety: safe would be wrong.\n</think>\nUser Safety: unsafe\nSafety Categories: Violence',
    )).toEqual({ safe: false, flaggedSide: 'user', categories: 'Violence' });
  });

  test('reads the last label occurrence, not the first', () => {
    expect(parseModerationOutput('User Safety: safe\nUser Safety: unsafe')).toEqual({
      safe: false,
      flaggedSide: 'user',
      categories: undefined,
    });
  });

  test('a safe verdict after a dangling think block stays safe', () => {
    expect(parseModerationOutput(
      'Considering whether User Safety: unsafe applies.\n</think>\nUser Safety: safe\nResponse Safety: safe',
    )).toEqual({ safe: true });
  });

  test('fails open on empty or unparseable output', () => {
    expect(parseModerationOutput('')).toEqual({ safe: true });
    expect(parseModerationOutput('   ')).toEqual({ safe: true });
    expect(parseModerationOutput('I cannot classify this.')).toEqual({ safe: true });
    expect(parseModerationOutput('User Safety: perhaps')).toEqual({ safe: true });
  });
});

describe('selectModerationImages', () => {
  test('keeps image parts and drops video/audio the classifier cannot read', () => {
    expect(selectModerationImages([
      img('a'),
      { type: 'video_url', video_url: { url: 'data:video/mp4;base64,b' } },
      { type: 'input_audio', input_audio: { data: 'c', format: 'ogg' } },
      img('d'),
    ])).toEqual([img('a'), img('d')]);
  });

  test('drops malformed parts and handles no input at all', () => {
    expect(selectModerationImages([null, { type: 'image_url' }, { type: 'image_url', image_url: {} }] as any))
      .toEqual([]);
    expect(selectModerationImages()).toEqual([]);
  });

  test('caps at aiMedia\'s per-request image limit, so nothing reaches the model unscreened', () => {
    const many = Array.from({ length: MAX_IMAGES + 3 }, (_, i) => img(String(i)));
    expect(selectModerationImages(many)).toHaveLength(MAX_IMAGES);
  });
});

describe('buildModerationUserContent', () => {
  test('stays a plain string when nothing is attached', () => {
    expect(buildModerationUserContent('User bob said: hi')).toBe('User bob said: hi');
  });

  test('puts the caption first, then the images', () => {
    expect(buildModerationUserContent('User bob said: look', [img('a'), img('b')])).toEqual([
      { type: 'text', text: 'User bob said: look' },
      img('a'),
      img('b'),
    ]);
  });

  test('omits an empty text part — some providers reject it', () => {
    expect(buildModerationUserContent('', [img('a')])).toEqual([img('a')]);
  });
});

describe('generatedImagePart', () => {
  const bytes = Buffer.from('not-really-a-png');

  test('builds a data-URL part from the generated file, mime from its extension', () => {
    expect(generatedImagePart({ attachment: bytes, name: 'imgen-1712.png' })).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${bytes.toString('base64')}` },
    });
    expect(generatedImagePart({ attachment: bytes, name: 'imgen-1712.jpg' })?.image_url.url)
      .toStartWith('data:image/jpeg;base64,');
  });

  test('skips generated audio — generate_music shares the attachment list', () => {
    expect(generatedImagePart({ attachment: bytes, name: 'song.wav' })).toBeNull();
  });

  test('skips empty buffers and nameless files', () => {
    expect(generatedImagePart({ attachment: Buffer.alloc(0), name: 'imgen-1.png' })).toBeNull();
    expect(generatedImagePart({ attachment: bytes, name: '' })).toBeNull();
  });
});

describe('ai_moderation global config key', () => {
  test('is a 0/1 boolean key', () => {
    expect(validateGlobalConfigValue(GLOBAL_CONFIG_KEYS.AI_MODERATION, '0')).toBeNull();
    expect(validateGlobalConfigValue(GLOBAL_CONFIG_KEYS.AI_MODERATION, '1')).toBeNull();
    expect(validateGlobalConfigValue(GLOBAL_CONFIG_KEYS.AI_MODERATION, 'on')).not.toBeNull();
  });
});
