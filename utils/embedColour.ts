/**
 * Embed colour input for `/event announce`.
 *
 * Free-text hex with autocompleted presets, rather than a fixed choice list: the
 * club's own palette is a handful of hex codes nobody remembers, and a poster
 * usually wants the colour off the poster. Presets cover the common cases; the
 * validator covers everything else.
 */

/** Named presets offered through autocomplete. Values are what gets stored. */
export const COLOUR_PRESETS: { name: string; value: `#${string}` }[] = [
  { name: 'Club pink (default)', value: '#EB459E' },
  { name: 'Blurple', value: '#5865F2' },
  { name: 'Green', value: '#57F287' },
  { name: 'Yellow', value: '#FEE75C' },
  { name: 'Orange', value: '#FAA61A' },
  { name: 'Red', value: '#ED4245' },
  { name: 'UWA blue', value: '#27348B' },
  { name: 'Black', value: '#23272A' },
  { name: 'White', value: '#FFFFFF' },
];

/** The colour an announcement uses when none is given. */
export const DEFAULT_ANNOUNCE_COLOUR = '#EB459E';

/**
 * Normalises a colour to `#RRGGBB`, or returns null.
 *
 * Accepts a leading `#` or not, and either case. Deliberately strict otherwise —
 * `setColor` throws on anything it can't parse, which inside a command handler
 * surfaces as the generic "an error occurred" rather than telling the admin
 * their colour was the problem. Validate here, reject with a real message.
 */
export function parseHexColour(input: string): `#${string}` | null {
  const trimmed = String(input ?? '').trim();
  const match = /^#?([0-9a-fA-F]{6})$/.exec(trimmed);
  if (!match) return null;
  return `#${match[1].toUpperCase()}`;
}

/** Autocomplete choices for a colour option: presets, filtered by what's typed. */
export function colourChoices(focused: string): { name: string; value: string }[] {
  const query = String(focused ?? '').trim().toLowerCase();
  const matches = COLOUR_PRESETS.filter((preset) => query.length === 0
    || preset.name.toLowerCase().includes(query)
    || preset.value.toLowerCase().includes(query));

  // A valid hex that matches no preset is still a legal answer — offer it back so
  // the user can click it rather than wondering why nothing appeared.
  const typed = parseHexColour(query);
  if (typed && !matches.some((preset) => preset.value === typed)) {
    return [{ name: `Use ${typed}`, value: typed }, ...matches].slice(0, 25);
  }
  return matches.map((preset) => ({ name: `${preset.name} — ${preset.value}`, value: preset.value })).slice(0, 25);
}
