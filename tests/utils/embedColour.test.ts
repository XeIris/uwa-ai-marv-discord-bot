import { describe, test, expect } from 'bun:test';
import { colourChoices, COLOUR_PRESETS, parseHexColour } from '../../utils/embedColour';

describe('parseHexColour', () => {
  test('accepts hex with or without a hash, in any case', () => {
    expect(parseHexColour('#ff5733')).toBe('#FF5733');
    expect(parseHexColour('FF5733')).toBe('#FF5733');
    expect(parseHexColour('  #Ff5733  ')).toBe('#FF5733');
  });

  test('rejects anything setColor would throw on', () => {
    // The point of validating here: a throw inside a command handler becomes the
    // generic "an error occurred", which never tells the admin it was the colour.
    ['', 'red', '#fff', '#GGGGGG', '#FF57333', '0x FF5733'].forEach((input) => {
      expect(parseHexColour(input)).toBeNull();
    });
  });

  test('every preset parses', () => {
    COLOUR_PRESETS.forEach((preset) => expect(parseHexColour(preset.value)).toBe(preset.value));
  });
});

describe('colourChoices', () => {
  test('offers every preset when nothing is typed', () => {
    expect(colourChoices('')).toHaveLength(COLOUR_PRESETS.length);
  });

  test('filters by name and by hex', () => {
    expect(colourChoices('blur')[0].value).toBe('#5865F2');
    expect(colourChoices('#5865F2')[0].value).toBe('#5865F2');
  });

  test('a valid hex matching no preset is offered back', () => {
    const [first] = colourChoices('#123456');
    expect(first.value).toBe('#123456');
    expect(first.name).toContain('#123456');
  });

  test('nonsense yields no choices rather than an error', () => {
    expect(colourChoices('nonsense')).toEqual([]);
  });

  test('never exceeds Discord\'s 25-choice cap', () => {
    expect(colourChoices('').length).toBeLessThanOrEqual(25);
  });
});
