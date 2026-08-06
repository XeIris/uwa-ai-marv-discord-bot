import { formatPerthDateTime } from './clubInfo';
import { MAX_AUTOCOMPLETE_CHOICES } from './committeeOptions';
import type { EventEntry } from '../database/models/EventModel';

/**
 * Autocompletes the `event` option for /event edit and /event delete. Suggests
 * upcoming events first, then falls back to everything so past events stay
 * editable/deletable.
 */
export async function respondWithEventChoices(client: any, interaction: any): Promise<void> {
  if (!interaction.guild) {
    await interaction.respond([]);
    return;
  }

  const focused = String(interaction.options.getFocused() ?? '').toLowerCase();
  const events: EventEntry[] = await client.db.event.listAll(interaction.guild.id, 100);
  const now = Date.now();
  const upcomingFirst = [...events].sort((a, b) => {
    const aPast = new Date(a.endsAt ?? a.startsAt).getTime() < now ? 1 : 0;
    const bPast = new Date(b.endsAt ?? b.startsAt).getTime() < now ? 1 : 0;
    return aPast - bPast;
  });

  await interaction.respond(
    upcomingFirst
      .map((event) => ({
        name: `${event.name} — ${formatPerthDateTime(event.startsAt)}`.slice(0, 100),
        value: event.id,
      }))
      .filter((choice) => choice.name.toLowerCase().includes(focused))
      .slice(0, MAX_AUTOCOMPLETE_CHOICES),
  );
}
