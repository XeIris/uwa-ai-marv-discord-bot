import { describe, test, expect } from 'bun:test';
import { parseNewSessionFlag, parseForgetFlag, parseSessionFlags } from '../../utils/sessionFlag';

describe('parseNewSessionFlag', () => {
  test('detects the flag and strips it from the text', () => {
    expect(parseNewSessionFlag('@marv -n what are the quorum rules?')).toEqual({
      requested: true,
      text: '@marv what are the quorum rules?',
    });
  });

  test('works at the start of the message', () => {
    expect(parseNewSessionFlag('-n @marv hi')).toEqual({ requested: true, text: '@marv hi' });
  });

  test('works at the end of the message', () => {
    expect(parseNewSessionFlag('@marv -n')).toEqual({ requested: true, text: '@marv' });
  });

  test('is case-insensitive', () => {
    expect(parseNewSessionFlag('@marv -N hi').requested).toBe(true);
  });

  test('leaves an ordinary message untouched', () => {
    const plain = '@marv how do committee elections work?';
    expect(parseNewSessionFlag(plain)).toEqual({ requested: false, text: plain });
  });

  test.each([
    ['@marv what does -no mean?', 'longer flag'],
    ['@marv explain foo-n please', 'suffix of a word'],
    ['@marv run with --n', 'double dash'],
    ['@marv-n hi', 'glued to the trigger'],
  ])('does not fire on %p (%s)', (input) => {
    expect(parseNewSessionFlag(input)).toEqual({ requested: false, text: input });
  });

  test('only strips the first occurrence — a later -n is the user\'s own text', () => {
    expect(parseNewSessionFlag('-n what does -n do?')).toEqual({
      requested: true,
      text: 'what does -n do?',
    });
  });

  test('preserves newlines in multi-line messages', () => {
    expect(parseNewSessionFlag('@marv -n line one\nline two').text).toBe('@marv line one\nline two');
  });

  test('handles empty and non-string input', () => {
    expect(parseNewSessionFlag('')).toEqual({ requested: false, text: '' });
    expect(parseNewSessionFlag(undefined as any)).toEqual({ requested: false, text: '' });
  });
});

describe('parseForgetFlag', () => {
  test('detects the flag and strips it from the text', () => {
    expect(parseForgetFlag('@marv -f')).toEqual({ requested: true, text: '@marv' });
  });

  test('is case-insensitive', () => {
    expect(parseForgetFlag('marv -F').requested).toBe(true);
  });

  test('leaves an ordinary message untouched', () => {
    const plain = 'marv what does the -flag do?';
    expect(parseForgetFlag(plain)).toEqual({ requested: false, text: plain });
  });

  test.each([
    ['marv what does -fo mean?', 'longer flag'],
    ['marv explain foo-f please', 'suffix of a word'],
    ['marv run with --f', 'double dash'],
    ['marv-f hi', 'glued to the trigger'],
  ])('does not fire on %p (%s)', (input) => {
    expect(parseForgetFlag(input)).toEqual({ requested: false, text: input });
  });

  test('handles empty and non-string input', () => {
    expect(parseForgetFlag('')).toEqual({ requested: false, text: '' });
    expect(parseForgetFlag(undefined as any)).toEqual({ requested: false, text: '' });
  });
});

describe('parseSessionFlags', () => {
  test('reads each flag on its own', () => {
    expect(parseSessionFlags('marv -n')).toEqual({ newSession: true, forgetLast: false, text: 'marv' });
    expect(parseSessionFlags('marv -f')).toEqual({ newSession: false, forgetLast: true, text: 'marv' });
  });

  test('strips both when both are present, in either order', () => {
    expect(parseSessionFlags('marv -n -f')).toEqual({ newSession: true, forgetLast: true, text: 'marv' });
    expect(parseSessionFlags('marv -f -n')).toEqual({ newSession: true, forgetLast: true, text: 'marv' });
  });

  test('an ordinary message carries neither flag and is unchanged', () => {
    const plain = 'marv when is the next social?';
    expect(parseSessionFlags(plain)).toEqual({ newSession: false, forgetLast: false, text: plain });
  });

  test('preserves newlines', () => {
    expect(parseSessionFlags('marv -f line one\nline two').text).toBe('marv line one\nline two');
  });
});
