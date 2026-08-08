import { describe, expect, test } from 'bun:test';
import {
  parseCoverageYears,
  stripTodoSections,
  buildCoverageNotice,
  sheetByToolName,
  getSheet,
  SHEET_TOOL_NAMES,
} from '../../utils/referenceSheets';

describe('parseCoverageYears', () => {
  test('reads a single year', () => {
    expect(parseCoverageYears('<!-- covers: 2026 -->\n# x')).toEqual([2026]);
  });

  test('reads a list and a range', () => {
    expect(parseCoverageYears('<!-- covers: 2026, 2028 -->')).toEqual([2026, 2028]);
    expect(parseCoverageYears('<!-- covers: 2026-2028 -->')).toEqual([2026, 2027, 2028]);
  });

  test('returns nothing when the marker is absent', () => {
    expect(parseCoverageYears('# no marker here')).toEqual([]);
  });

  test('ignores an absurd range rather than allocating it', () => {
    expect(parseCoverageYears('<!-- covers: 1000-2999 -->')).toEqual([]);
  });
});

describe('buildCoverageNotice', () => {
  test('says nothing when the year is covered', () => {
    expect(buildCoverageNotice('recall_key_dates', [2026], 2026)).toBeNull();
  });

  test('warns loudly, and forbids extrapolation, when it is not', () => {
    const notice = buildCoverageNotice('recall_key_dates', [2026], 2027)!;
    expect(notice).toContain('OUT OF DATE');
    expect(notice).toMatch(/do not use, adapt, or extrapolate/i);
    expect(notice).toContain('2027');
  });

  test('flags a sheet that never declared its coverage', () => {
    expect(buildCoverageNotice('recall_key_dates', [], 2026)).toMatch(/unverified/i);
  });
});

describe('stripTodoSections', () => {
  const doc = [
    '# Title',
    '',
    '## Answered',
    'Real content.',
    '',
    '## Unanswered',
    '<!-- TODO: committee to fill this in -->',
    '',
    '## Also answered',
    'More real content.',
  ].join('\n');

  test('removes only the TODO section', () => {
    const { text, strippedCount } = stripTodoSections(doc);
    expect(strippedCount).toBe(1);
    expect(text).toContain('## Answered');
    expect(text).toContain('## Also answered');
    expect(text).not.toContain('Unanswered');
    expect(text).not.toContain('TODO');
  });

  test('a TODO section does not swallow the following section', () => {
    const { text } = stripTodoSections(doc);
    expect(text).toContain('More real content.');
  });

  test('keeps subsections with the parent it belongs to', () => {
    const nested = '## Kept\ntext\n### Sub\nsubtext\n## Dropped\n<!-- TODO -->\n';
    const { text, strippedCount } = stripTodoSections(nested);
    expect(strippedCount).toBe(1);
    expect(text).toContain('### Sub');
    expect(text).not.toContain('Dropped');
  });

  test('leaves a document with no TODOs alone', () => {
    const { strippedCount } = stripTodoSections('## A\nx\n## B\ny');
    expect(strippedCount).toBe(0);
  });
});

describe('sheet registry', () => {
  test('every declared sheet resolves and has a description', () => {
    for (const name of SHEET_TOOL_NAMES) {
      const sheet = sheetByToolName(name);
      expect(sheet).toBeDefined();
      expect(sheet!.description.length).toBeGreaterThan(60);
    }
  });

  test('an unknown sheet name errors rather than throwing', async () => {
    expect(await getSheet('recall_nonexistent')).toMatch(/^Error:/);
  });
});

describe('shipped sheets', () => {
  test.each(SHEET_TOOL_NAMES)('%s loads and returns content', async (name) => {
    const text = await getSheet(name);
    expect(text).not.toMatch(/^Error:/);
    expect(text.length).toBeGreaterThan(100);
    // TODO placeholders must never reach the model.
    expect(text).not.toContain('<!-- TODO');
  });

  test('the calendar sheet is in date for the current year', async () => {
    // Fails deliberately once 2026 rolls over: the point is to notice.
    const text = await getSheet('recall_key_dates');
    expect(text).not.toContain('OUT OF DATE');
  });

  test('the calendar sheet warns when read in an uncovered year', async () => {
    const text = await getSheet('recall_key_dates', new Date('2031-03-01T00:00:00Z'));
    expect(text).toContain('OUT OF DATE');
    expect(text).toContain('2031');
  });

  test('the FAQ reports its unfilled entries instead of serving them', async () => {
    const text = await getSheet('recall_faq');
    expect(text).toMatch(/not filled in yet/i);
    expect(text).toMatch(/do not improvise/i);
  });
});
