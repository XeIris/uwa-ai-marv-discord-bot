import { describe, test, expect } from 'bun:test';
import { computeDueAt, toReminderLead, REMINDER_LEADS } from '../../utils/eventReminders';

/** 2026-09-01 18:00 Perth = 10:00 UTC. */
const EVENING = '2026-09-01T10:00:00.000Z';

describe('computeDueAt', () => {
  test('offset leads subtract from the start time', () => {
    expect(computeDueAt(EVENING, 'hour')!.toISOString()).toBe('2026-09-01T09:00:00.000Z');
    expect(computeDueAt(EVENING, 'day')!.toISOString()).toBe('2026-08-31T10:00:00.000Z');
    expect(computeDueAt(EVENING, 'week')!.toISOString()).toBe('2026-08-25T10:00:00.000Z');
  });

  test('morning is 09:00 Perth on the event\'s day — 01:00 UTC', () => {
    expect(computeDueAt(EVENING, 'morning')!.toISOString()).toBe('2026-09-01T01:00:00.000Z');
  });

  test('morning uses the Perth calendar date, not the UTC one', () => {
    // 2026-09-02 07:00 Perth = 2026-09-01 23:00 UTC. The UTC date is the 1st, so
    // a naive implementation would aim at the morning of the wrong day.
    const earlyPerthMorning = '2026-09-01T23:00:00.000Z';
    // 07:00 is before 09:00, so there is no valid "morning of" for this one...
    expect(computeDueAt(earlyPerthMorning, 'morning')).toBeNull();
    // ...but an event later that same Perth day resolves to the 2nd, not the 1st.
    const sameDayLater = '2026-09-02T04:00:00.000Z'; // 12:00 Perth on the 2nd
    expect(computeDueAt(sameDayLater, 'morning')!.toISOString()).toBe('2026-09-02T01:00:00.000Z');
  });

  test('a lead that would land at or after the start is rejected, not clamped', () => {
    const nineAmPerth = '2026-09-01T01:00:00.000Z';
    expect(computeDueAt(nineAmPerth, 'morning')).toBeNull();
    // Offsets are always strictly before the start, so they still resolve.
    expect(computeDueAt(nineAmPerth, 'hour')).not.toBeNull();
  });

  test('an unparseable start time yields null for every lead', () => {
    REMINDER_LEADS.forEach((lead) => {
      expect(computeDueAt('not a date', lead)).toBeNull();
    });
  });
});

describe('toReminderLead', () => {
  test('accepts the known leads and rejects everything else', () => {
    REMINDER_LEADS.forEach((lead) => expect(toReminderLead(lead)).toBe(lead));
    expect(toReminderLead('fortnight')).toBeNull();
    expect(toReminderLead(null)).toBeNull();
    expect(toReminderLead(7)).toBeNull();
  });
});
