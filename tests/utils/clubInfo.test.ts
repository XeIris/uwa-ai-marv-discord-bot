import { describe, test, expect } from 'bun:test';
import {
  parsePerthDateTime, perthDateString, formatPerthDateTime, discordTimestamp,
  formatCommitteeRoster, formatEventList,
} from '../../utils/clubInfo';
import { latexToMarkdown } from '../../utils/latexToMarkdown';
import type { CommitteeEntry } from '../../database/models/CommitteeModel';
import type { EventEntry } from '../../database/models/EventModel';

describe('parsePerthDateTime', () => {
  test('reads Perth local time as UTC+8', () => {
    // 18:00 in Perth is 10:00 UTC the same day.
    expect(parsePerthDateTime('2026-08-20 18:00')?.toISOString()).toBe('2026-08-20T10:00:00.000Z');
  });

  test('accepts the ISO T separator', () => {
    expect(parsePerthDateTime('2026-08-20T18:00')?.toISOString()).toBe('2026-08-20T10:00:00.000Z');
  });

  test('applies the same offset in January — AWST has no DST', () => {
    expect(parsePerthDateTime('2026-01-15 12:00')?.toISOString()).toBe('2026-01-15T04:00:00.000Z');
  });

  test('midnight rolls back into the previous UTC day', () => {
    expect(parsePerthDateTime('2026-08-20 00:00')?.toISOString()).toBe('2026-08-19T16:00:00.000Z');
  });

  test.each([
    ['', 'empty'],
    ['tomorrow', 'prose'],
    ['20-08-2026 18:00', 'wrong field order'],
    ['2026-08-20', 'missing time'],
    ['2026-08-20 6:00', 'unpadded hour'],
    ['2026-13-01 10:00', 'month out of range'],
    ['2026-08-20 25:00', 'hour out of range'],
    ['2026-08-20 10:75', 'minute out of range'],
    ['2026-02-30 10:00', 'day that does not exist'],
  ])('rejects %p (%s)', (input) => {
    expect(parsePerthDateTime(input)).toBeNull();
  });

  test('round-trips through formatPerthDateTime', () => {
    const parsed = parsePerthDateTime('2026-08-20 18:00')!;
    expect(formatPerthDateTime(parsed.toISOString())).toBe('2026-08-20 18:00');
  });
});

describe('perthDateString', () => {
  test('is already the next day in Perth when UTC is still on the previous evening', () => {
    expect(perthDateString(new Date('2026-08-19T17:00:00.000Z'))).toBe('2026-08-20');
  });
});

describe('discordTimestamp', () => {
  test('emits epoch-second markup', () => {
    expect(discordTimestamp('2026-08-20T10:00:00.000Z')).toBe('<t:1787220000:F>');
    expect(discordTimestamp('2026-08-20T10:00:00.000Z', 'R')).toBe('<t:1787220000:R>');
  });

  test('passes unparseable input straight through', () => {
    expect(discordTimestamp('not a date')).toBe('not a date');
  });
});

const entry = (over: Partial<CommitteeEntry>): CommitteeEntry => ({
  id: 1,
  serverId: '1',
  userId: '100000000000000001',
  title: 'President',
  displayName: 'Ada',
  isExecutive: 1,
  sortOrder: 1,
  updatedAt: '',
  ...over,
});

describe('formatCommitteeRoster', () => {
  test('splits executives from the rest and mentions each member', () => {
    const out = formatCommitteeRoster([
      entry({}),
      entry({
        id: 2, title: 'Head of Marketing', displayName: 'Grace', isExecutive: 0,
      }),
    ]);
    expect(out).toContain('**Executive**');
    expect(out).toContain('- President: <@100000000000000001> — Ada');
    expect(out).toContain('**Non-Executive**');
  });

  test('omits an empty section', () => {
    expect(formatCommitteeRoster([entry({})])).not.toContain('Non-Executive');
  });

  test('says so when the roster is empty', () => {
    expect(formatCommitteeRoster([])).toMatch(/no committee members/i);
  });
});

describe('formatEventList', () => {
  const event: EventEntry = {
    id: 3,
    serverId: '1',
    name: 'AI Club Social',
    description: 'Come say hi',
    startsAt: '2026-08-20T10:00:00.000Z',
    endsAt: null,
    location: 'Guild Village',
    url: null,
    createdBy: null,
    createdAt: '',
    imageChannelId: null,
    imageMessageId: null,
    imageAttachmentId: null,
    reminderDaySentAt: null,
    reminderSoonSentAt: null,
  };

  test('renders name, Discord timestamp and location', () => {
    const out = formatEventList([event]);
    expect(out).toContain('**AI Club Social** (id 3)');
    expect(out).toContain('<t:1787220000:F>');
    expect(out).toContain('Where: Guild Village');
  });

  test('says so when there is nothing scheduled', () => {
    expect(formatEventList([])).toMatch(/no events/i);
  });
});

describe('latexToMarkdown', () => {
  const tex = String.raw`
\documentclass{article}
\title{Ignore me}
\begin{document}
\maketitle
\tableofcontents
% a comment
\section{4. Membership}
\begin{enumerate}[label=4.\arabic*]
 \item Members must pay \$5AUD.
 \item To be eligible a person must:
 \begin{enumerate}[label=\theenumi.\arabic*]
   \item Be a current member of the Guild; and
   \item Be enrolled at UWA.
 \end{enumerate}
 \item Membership lapses annually.
\end{enumerate}
\end{document}
`;

  const md = latexToMarkdown(tex);

  test('drops the preamble', () => {
    expect(md).not.toContain('documentclass');
    expect(md).not.toContain('Ignore me');
  });

  test('turns sections into markdown headings', () => {
    expect(md).toContain('## 4. Membership');
  });

  test('numbers clauses from the label spec', () => {
    expect(md).toContain('4.1 Members must pay $5AUD.');
    expect(md).toContain('4.3 Membership lapses annually.');
  });

  test('resolves \\theenumi against the parent clause', () => {
    expect(md).toContain('4.2.1 Be a current member of the Guild; and');
    expect(md).toContain('4.2.2 Be enrolled at UWA.');
  });

  test('strips comments and leaves no LaTeX macros behind', () => {
    expect(md).not.toContain('a comment');
    expect(md).not.toMatch(/\\[a-zA-Z]/);
  });

  test('joins an item that wraps across lines', () => {
    const wrapped = latexToMarkdown(String.raw`\begin{document}
\begin{enumerate}[label=1.\arabic*]
\item The first part
of a wrapped clause.
\end{enumerate}
\end{document}`);
    expect(wrapped).toContain('1.1 The first part of a wrapped clause.');
  });
});
