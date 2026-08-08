import { describe, expect, test } from 'bun:test';
import { OFFICIAL_LINKS, UWA_LINKS, formatLinkList } from '../../utils/clubLinks';

const SHEET_PATH = `${import.meta.dir}/../../data/skills/club-links.md`;
const ALL_LINKS = [...OFFICIAL_LINKS, ...UWA_LINKS];

/**
 * The `/links` command reads utils/clubLinks.ts; Marv reads
 * data/skills/club-links.md. These tests are the reason it's safe to keep the
 * same URLs in two shapes — update one and forget the other, and the suite fails
 * instead of the bot quietly handing out a half-updated set of links.
 */
describe('club links stay in sync with the sheet Marv reads', () => {
  test('every structured link appears in the markdown sheet', async () => {
    const sheet = await Bun.file(SHEET_PATH).text();
    for (const link of ALL_LINKS) {
      expect(sheet, `${link.url} missing from club-links.md`).toContain(link.url);
    }
  });

  test('every URL in the markdown sheet is in the structured list', async () => {
    const sheet = await Bun.file(SHEET_PATH).text();
    const known = new Set(ALL_LINKS.map((l) => l.url));
    const urls = (sheet.match(/https?:\/\/[^\s<>)\]]+/g) ?? [])
      .map((url) => url.replace(/[.,]+$/, ''));
    for (const url of urls) {
      expect(known.has(url), `${url} is in club-links.md but not utils/clubLinks.ts`).toBe(true);
    }
  });
});

describe('link data', () => {
  test('all links are https and non-empty', () => {
    for (const link of ALL_LINKS) {
      expect(link.url.startsWith('https://')).toBe(true);
      expect(link.label.length).toBeGreaterThan(0);
      expect(link.blurb.length).toBeGreaterThan(0);
    }
  });

  test('no duplicate urls', () => {
    const urls = ALL_LINKS.map((l) => l.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  test('the join link and the discord invite are both present', () => {
    const urls = OFFICIAL_LINKS.map((l) => l.url).join(' ');
    expect(urls).toContain('uwastudentguild.com');
    expect(urls).toContain('discord.gg');
  });

  test('formatLinkList renders clickable markdown', () => {
    const out = formatLinkList([{ label: 'X', url: 'https://example.com', blurb: 'why' }]);
    expect(out).toBe('**[X](https://example.com)**\nwhy');
  });
});
