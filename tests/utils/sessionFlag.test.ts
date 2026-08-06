import { describe, test, expect } from 'bun:test';
import { parseNewSessionFlag } from '../../utils/sessionFlag';

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
