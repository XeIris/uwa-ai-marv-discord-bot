/**
 * Shared option handling for the /committee and /event commands: input validation
 * and the autocomplete helpers Discord calls before the command itself runs.
 */

export const MAX_TITLE_CHARS = 80;
/** Discord rejects autocomplete responses with more than 25 choices. */
export const MAX_AUTOCOMPLETE_CHOICES = 25;

/** Trims and length-checks a role title. Returns null when it isn't usable. */
export function normaliseTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const title = raw.trim().replace(/\s+/g, ' ');
  if (title.length === 0 || title.length > MAX_TITLE_CHARS) return null;
  return title;
}

/** Prefers the member's server nickname, falling back to their global name. */
export function resolveDisplayName(member: any, user: any): string {
  return member?.nickname || user?.globalName || user?.displayName || user?.username || 'Unknown';
}

/**
 * Autocompletes the `title` option against the titles the selected user actually
 * holds. Discord sends every option's current value with the autocomplete request,
 * so `user` is already available here.
 */
export async function respondWithUserTitles(client: any, interaction: any): Promise<void> {
  if (!interaction.guild) {
    await interaction.respond([]);
    return;
  }

  const userId = interaction.options.get('user')?.value;
  if (typeof userId !== 'string') {
    await interaction.respond([]);
    return;
  }

  const focused = String(interaction.options.getFocused() ?? '').toLowerCase();
  const titles: string[] = await client.db.committee.getTitlesForUser(interaction.guild.id, userId);

  await interaction.respond(
    titles
      .filter((title) => title.toLowerCase().includes(focused))
      .slice(0, MAX_AUTOCOMPLETE_CHOICES)
      .map((title) => ({ name: title, value: title })),
  );
}
