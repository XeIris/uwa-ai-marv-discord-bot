/**
 * Lead times for the per-user DM reminders (`/event remindme`).
 *
 * Three of the four are plain offsets from the start. `morning` is not: it's
 * 09:00 **Perth local** on the day of the event, which is a wall-clock time, so
 * it can't be expressed as an offset and has to be computed from the event's
 * Perth calendar date. That asymmetry is the reason subscriptions store an
 * absolute `due_at` resolved at subscribe time rather than a lead the sweep
 * re-evaluates.
 */

import { parsePerthDateTime, perthDateString } from './perthTime';

export const REMINDER_LEADS = ['week', 'day', 'morning', 'hour'] as const;

export type ReminderLead = typeof REMINDER_LEADS[number];

/** The hour, Perth local, that the `morning` lead fires at. */
export const MORNING_HOUR_PERTH = 9;

export const LEAD_LABELS: Record<ReminderLead, string> = {
  week: 'a week before',
  day: 'the day before',
  morning: `the morning of (${String(MORNING_HOUR_PERTH).padStart(2, '0')}:00 Perth)`,
  hour: 'an hour before',
};

/** Slash-command choices, in lead order (earliest first). */
export const LEAD_CHOICES = [
  { name: 'Week before', value: 'week' },
  { name: 'Day before', value: 'day' },
  { name: 'On the day itself (9am Perth)', value: 'morning' },
  { name: '1 hour before', value: 'hour' },
];

const HOUR_MS = 60 * 60 * 1000;

/** Narrows an untrusted string to a lead, or null. Applied at every boundary. */
export function toReminderLead(value: unknown): ReminderLead | null {
  return (REMINDER_LEADS as readonly unknown[]).includes(value) ? value as ReminderLead : null;
}

/**
 * The instant a lead fires for an event starting at `startsAtIso`.
 *
 * Returns null when the event's start is unparseable, or when the computed time
 * isn't strictly before the start — which `morning` hits for any event beginning
 * at or before 09:00 Perth. Callers reject rather than clamp: a "reminder" that
 * lands after the thing started is worse than being told to pick another lead.
 */
export function computeDueAt(startsAtIso: string, lead: ReminderLead): Date | null {
  const start = new Date(startsAtIso);
  if (Number.isNaN(start.getTime())) return null;

  let due: Date | null;
  if (lead === 'morning') {
    // 09:00 on the event's Perth calendar date — not the UTC one, which is the
    // previous day for anything starting before 08:00 Perth.
    due = parsePerthDateTime(`${perthDateString(start)} ${String(MORNING_HOUR_PERTH).padStart(2, '0')}:00`);
  } else {
    const offsetMs = { week: 7 * 24 * HOUR_MS, day: 24 * HOUR_MS, hour: HOUR_MS }[lead];
    due = new Date(start.getTime() - offsetMs);
  }

  if (!due || Number.isNaN(due.getTime()) || due.getTime() >= start.getTime()) return null;
  return due;
}
