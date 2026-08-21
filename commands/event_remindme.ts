import { Command } from './classes/Command';
import { discordTimestamp } from '../utils/clubInfo';
import { respondWithEventChoices } from '../utils/eventOptions';
import {
  LEAD_CHOICES, LEAD_LABELS, toReminderLead,
} from '../utils/eventReminders';
import type { ReminderLead } from '../utils/eventReminders';
import { log } from '../utils/log';

/**
 * Per-user DM reminders for an event. Open to every member — the only thing it
 * signs you up for is a DM about your own club's event — and always ephemeral,
 * because nobody else needs to see who set a reminder.
 *
 * One lead per invocation (a slash option can't multi-select), but the leads
 * stack: running it again with a different lead adds to what you have rather
 * than replacing it.
 */
class EventRemindMe extends Command {
  constructor(client: any) {
    super(client, 'remindme', 'Get a DM before an event starts', [
      {
        name: 'event', description: 'Which event', type: 4, required: true, autocomplete: true,
      },
      {
        name: 'when',
        description: 'How far ahead to remind you (omit to see what you already have)',
        type: 3,
        choices: LEAD_CHOICES,
      },
      {
        name: 'cancel',
        description: 'Remove this reminder instead (omit "when" to remove all of yours for this event)',
        type: 5,
      },
    ], { isSubcommandOf: 'event', ephemeral: true });
  }

  async autocomplete(interaction: any): Promise<void> {
    await respondWithEventChoices(this.client, interaction, { upcomingOnly: true });
  }

  async run(interaction: any): Promise<void> {
    if (!interaction.guild) {
      await interaction.editReply('This command must be used in a server.');
      return;
    }

    const id = interaction.options.getInteger('event');
    if (!Number.isInteger(id) || id <= 0) {
      await interaction.editReply('Pick an event from the list.');
      return;
    }
    const event = await this.client.db.event.getById(interaction.guild.id, id);
    if (!event) {
      await interaction.editReply(`No event with id \`${id}\` in this server.`);
      return;
    }

    // Kept raw so "omitted" stays distinguishable from "supplied but not one of
    // the choices" — collapsing both to null would silently show the current
    // reminders instead of saying the lead wasn't understood.
    const rawWhen = interaction.options.getString('when');
    const lead = toReminderLead(rawWhen);
    if (rawWhen !== null && !lead) {
      await interaction.editReply(`\`${rawWhen}\` isn't a lead time I know — pick one from the list.`);
      return;
    }
    const cancelling = interaction.options.getBoolean('cancel') === true;
    const userId = interaction.user.id;

    if (cancelling) {
      await this.cancel(interaction, id, userId, event.name, lead);
      return;
    }
    if (!lead) {
      await this.showCurrent(interaction, id, userId, event.name);
      return;
    }

    if (new Date(event.startsAt).getTime() <= Date.now()) {
      await interaction.editReply(`**${event.name}** has already started — nothing left to remind you about.`);
      return;
    }

    await this.subscribe(interaction, event, userId, lead);
  }

  private async subscribe(interaction: any, event: any, userId: string, lead: ReminderLead): Promise<void> {
    // Whether this is their first reminder in this guild decides if we probe
    // their DMs below — check before subscribing, or the new row counts itself.
    const hadReminders = (await this.client.db.eventReminder
      .listForUser(interaction.guild.id, userId, 1)).length > 0;

    const dueAt = await this.client.db.eventReminder
      .subscribe(interaction.guild.id, event.id, userId, lead, event.startsAt);

    if (!dueAt) {
      // Only `morning` can fail this way: an event starting at or before 09:00
      // Perth has no "morning of" that precedes it.
      await interaction.editReply(
        `**${event.name}** starts too early in the day for a 9am reminder — `
        + 'try `Day before` or `1 hour before` instead.',
      );
      return;
    }

    if (dueAt.getTime() <= Date.now()) {
      // The lead is in the past (subscribing an hour before a "day before"
      // reminder). Don't fire immediately and don't silently keep a dead row.
      await this.client.db.eventReminder.unsubscribe(event.id, userId, lead);
      await interaction.editReply(
        `${discordTimestamp(dueAt.toISOString())} has already passed, so a reminder ${LEAD_LABELS[lead]} `
        + `wouldn't reach you in time. Pick a shorter lead — **${event.name}** starts `
        + `${discordTimestamp(event.startsAt, 'R')}.`,
      );
      return;
    }

    const lines = [
      `I'll DM you about **${event.name}** at ${discordTimestamp(dueAt.toISOString())} `
      + `(${discordTimestamp(dueAt.toISOString(), 'R')}) — ${LEAD_LABELS[lead]}.`,
    ];

    // Probe their DMs on the first subscription only, so a member with closed
    // DMs finds out now rather than by silently never being reminded. Repeat
    // subscriptions skip it — one confirmation is helpful, four is spam.
    if (!hadReminders) {
      const reachable = await this.canDm(userId);
      if (!reachable) {
        lines.push(
          '',
          '⚠ I couldn\'t send you a test DM, so the reminder won\'t reach you either. '
          + 'Enable **Settings → Privacy & Safety → Direct Messages** for this server, then run this again.',
        );
      }
    }

    lines.push('', 'Add more lead times by running this again; remove one with `cancel: True`.');
    await interaction.editReply(lines.join('\n'));
  }

  /** Sends a throwaway DM to find out whether we can reach this user at all. */
  private async canDm(userId: string): Promise<boolean> {
    try {
      const user = await this.client.users.fetch(userId);
      await user.send('👍 Reminder set — this is just me checking I can reach you here.');
      return true;
    } catch (err: any) {
      const code = err?.code ?? err?.rawError?.code;
      if (code !== 50007) log(`[events] DM probe for ${userId} failed with an unexpected error: ${err}`);
      return false;
    }
  }

  private async cancel(
    interaction: any,
    eventId: number,
    userId: string,
    eventName: string,
    lead: ReminderLead | null,
  ): Promise<void> {
    if (!lead) {
      const removed = await this.client.db.eventReminder.unsubscribeAll(eventId, userId);
      await interaction.editReply(removed === 0
        ? `You had no reminders set for **${eventName}**.`
        : `Removed ${removed} reminder${removed === 1 ? '' : 's'} for **${eventName}**.`);
      return;
    }

    const removed = await this.client.db.eventReminder.unsubscribe(eventId, userId, lead);
    await interaction.editReply(removed
      ? `Removed your reminder ${LEAD_LABELS[lead]} for **${eventName}**.`
      : `You had no reminder ${LEAD_LABELS[lead]} set for **${eventName}**.`);
  }

  private async showCurrent(
    interaction: any,
    eventId: number,
    userId: string,
    eventName: string,
  ): Promise<void> {
    const existing = await this.client.db.eventReminder.listForUserEvent(eventId, userId);
    if (existing.length === 0) {
      await interaction.editReply(
        `You have no reminders set for **${eventName}**. Pick a \`when\` to add one.`,
      );
      return;
    }

    const lines = existing.map((reminder: any) => {
      const lead = toReminderLead(reminder.lead);
      const label = lead ? LEAD_LABELS[lead] : reminder.lead;
      const state = reminder.sentAt ? ' — already sent' : '';
      return `• ${label} (${discordTimestamp(reminder.dueAt, 'R')})${state}`;
    });

    await interaction.editReply(
      [`Your reminders for **${eventName}**:`, ...lines, '', 'Remove one with `cancel: True`.'].join('\n'),
    );
  }
}

export default EventRemindMe;
