import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, PermissionsBitField,
} from 'discord.js';
import { AdminCommand } from './classes/AdminCommand';
import { discordTimestamp } from '../utils/clubInfo';
import { colourChoices, DEFAULT_ANNOUNCE_COLOUR, parseHexColour } from '../utils/embedColour';
import { fetchEventImageFile } from '../utils/eventImage';
import { respondWithEventChoices } from '../utils/eventOptions';
import { log, logError } from '../utils/log';

/**
 * Posts an event to a channel with an `@everyone` ping.
 *
 * Admin-only, and behind a confirmation button: the reply is an ephemeral preview
 * of the exact message, and only pressing Confirm sends it. An `@everyone` can't
 * be un-rung — a typo'd announcement has already pinged the whole server by the
 * time anyone notices — so the extra click is the point, not friction.
 *
 * The image is **re-uploaded onto the announcement itself** rather than linked.
 * Stored event images resolve to signed CDN URLs that expire within a day
 * (utils/eventImage.ts); an announcement is the event's standing notice in the
 * channel and has to still show its poster next week.
 */

/** How long the preview's Confirm button stays live. */
const CONFIRM_TIMEOUT_MS = 2 * 60 * 1000;

/** What the bot needs in the target channel to post a pinging announcement. */
const REQUIRED_PERMISSIONS: [bigint, string][] = [
  [PermissionsBitField.Flags.ViewChannel, 'View Channel'],
  [PermissionsBitField.Flags.SendMessages, 'Send Messages'],
  [PermissionsBitField.Flags.EmbedLinks, 'Embed Links'],
  [PermissionsBitField.Flags.AttachFiles, 'Attach Files'],
  [PermissionsBitField.Flags.MentionEveryone, 'Mention @everyone'],
];

/** Channel types an announcement may target: guild text (0) and announcement (5). */
const ANNOUNCEABLE_CHANNEL_TYPES: readonly number[] = [0, 5];

class EventAnnounce extends AdminCommand {
  constructor(client: any) {
    super(client, 'announce', 'Announce an event with an @everyone ping', [
      {
        name: 'event', description: 'Which event to announce', type: 4, required: true, autocomplete: true,
      },
      {
        name: 'channel', description: 'Where to post it (defaults to this channel)', type: 7, channel_types: ANNOUNCEABLE_CHANNEL_TYPES,
      },
      { name: 'message', description: 'A line of your own, above the embed', type: 3 },
      {
        name: 'colour',
        description: 'Embed colour — a preset or a hex code like #FF5733',
        type: 3,
        autocomplete: true,
      },
    ], { isSubcommandOf: 'event', ephemeral: true });
  }

  async autocomplete(interaction: any): Promise<void> {
    // One handler serves every autocompleting option on this subcommand.
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'colour') {
      await interaction.respond(colourChoices(focused.value));
      return;
    }
    await respondWithEventChoices(this.client, interaction, { upcomingOnly: true });
  }

  async run(interaction: any): Promise<void> {
    if (!interaction.guild) {
      await interaction.editReply('This command must be used in a server.');
      return;
    }

    const id = interaction.options.getInteger('event');
    const event = await this.client.db.event.getById(interaction.guild.id, id);
    if (!event) {
      await interaction.editReply(`No event with id \`${id}\` in this server.`);
      return;
    }

    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    // Same whitelist the `channel` option declares. The implicit fallback
    // bypasses that declaration, and isTextBased() alone would let threads and
    // voice text through — where posting needs a different permission than the
    // one checked below, so the send would fail into the generic catch instead
    // of saying what's actually wrong.
    if (!ANNOUNCEABLE_CHANNEL_TYPES.includes(channel?.type)) {
      await interaction.editReply('Pick a text or announcement channel to announce in.');
      return;
    }

    const missing = this.missingPermissions(interaction, channel);
    if (missing.length > 0) {
      // Checked before anything is built. Without Mention @everyone the ping
      // degrades silently to plain text, which looks like it worked — better to
      // refuse than to post a dud announcement nobody gets pinged by.
      await interaction.editReply(
        `I'm missing **${missing.join('**, **')}** in ${channel}. `
        + 'Grant those and run this again.',
      );
      return;
    }

    const note = interaction.options.getString('message')?.trim() ?? '';
    if (note.length > 1500) {
      await interaction.editReply('That message is too long — keep it under 1500 characters.');
      return;
    }

    const rawColour = interaction.options.getString('colour');
    const colour = rawColour === null ? DEFAULT_ANNOUNCE_COLOUR : parseHexColour(rawColour);
    if (!colour) {
      await interaction.editReply(
        `\`${rawColour}\` isn't a colour I can use. Give me a 6-digit hex code like \`#FF5733\`, `
        + 'or pick one of the suggestions.',
      );
      return;
    }

    const image = await fetchEventImageFile(this.client, this.client.db, event);
    const embed = this.buildEmbed(event, image?.name ?? null, colour);
    const files = image ? [image] : [];
    const content = note ? `@everyone ${note}` : '@everyone';

    const confirmed = await this.confirm(interaction, channel, embed, files, content, Boolean(image));
    if (!confirmed) return;

    try {
      const posted = await channel.send({
        content,
        embeds: [embed],
        files,
        // Explicit: this is the one place in the bot that deliberately pings
        // everyone, and it should never be an accident of the default.
        allowedMentions: { parse: ['everyone'] },
      });
      log(`[events] ${interaction.user.tag ?? interaction.user.id} announced event ${event.id} in ${channel.id}`);
      await interaction.editReply({
        content: `Announced **${event.name}** in ${channel}: ${posted.url}`,
        embeds: [],
        files: [],
        components: [],
      });
    } catch (err) {
      logError(`[events] failed to announce event ${event.id} in ${channel.id}:`, err);
      await interaction.editReply({
        content: 'Discord rejected the announcement — check my permissions in that channel and try again.',
        embeds: [],
        files: [],
        components: [],
      });
    }
  }

  /** Permission names the bot lacks in the target channel, in display order. */
  private missingPermissions(interaction: any, channel: any): string[] {
    const me = interaction.guild.members.me ?? null;
    const permissions = me ? channel.permissionsFor(me) : null;
    // No resolvable permissions means we can't see the channel at all.
    if (!permissions) return ['View Channel'];
    return REQUIRED_PERMISSIONS
      .filter(([flag]) => !permissions.has(flag))
      .map(([, name]) => name);
  }

  /**
   * Shows the exact message as an ephemeral preview and waits for Confirm.
   *
   * The preview carries the same embed and the same image bytes as the real post,
   * so what the admin approves is what the server sees — with one deliberate
   * difference: `allowedMentions` is empty here, so previewing an announcement
   * never pings anyone.
   */
  private async confirm(
    interaction: any,
    channel: any,
    embed: EmbedBuilder,
    files: any[],
    content: string,
    hasImage: boolean,
  ): Promise<boolean> {
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('announce_confirm').setLabel('Send it').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('announce_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );

    const warning = hasImage ? '' : '\nThis event has no image, so the embed goes out without one.';
    const preview = await interaction.editReply({
      content: `**Preview — nothing has been posted yet.** This will go to ${channel} `
        + `and ping everyone:${warning}\n\n${content}`,
      embeds: [embed],
      files,
      components: [buttons],
      allowedMentions: { parse: [] },
    });

    try {
      const press = await preview.awaitMessageComponent({
        componentType: ComponentType.Button,
        // The reply is ephemeral so only the invoker can see it, but filter on
        // the user anyway rather than relying on that as the access control.
        filter: (button: any) => button.user.id === interaction.user.id,
        time: CONFIRM_TIMEOUT_MS,
      });
      await press.deferUpdate();

      if (press.customId !== 'announce_confirm') {
        await interaction.editReply({
          content: 'Cancelled — nothing was posted.', embeds: [], files: [], components: [],
        });
        return false;
      }
      return true;
    } catch {
      // awaitMessageComponent rejects on timeout. Clear the buttons so a stale
      // preview can't be confirmed later.
      await interaction.editReply({
        content: 'Timed out — nothing was posted. Run the command again when you\'re ready.',
        embeds: [],
        files: [],
        components: [],
      }).catch(() => {});
      return false;
    }
  }

  // eslint-disable-next-line class-methods-use-this
  private buildEmbed(event: any, imageName: string | null, colour: string): EmbedBuilder {
    const lines = [`${discordTimestamp(event.startsAt)} (${discordTimestamp(event.startsAt, 'R')})`];
    if (event.endsAt) lines.push(`until ${discordTimestamp(event.endsAt)}`);
    if (event.location) lines.push(`📍 ${event.location}`);
    if (event.description) lines.push('', event.description);
    if (event.url) lines.push('', event.url);
    lines.push('', 'Want a reminder? Run `/event remindme`.');

    const embed = new EmbedBuilder()
      .setTitle(event.name)
      .setDescription(lines.join('\n').slice(0, 4096))
      .setColor(colour as `#${string}`);
    // Points at the file attached to this same message, so it never expires.
    // The name has to match the attachment's exactly, extension included.
    if (imageName) embed.setImage(`attachment://${imageName}`);
    return embed;
  }
}

export default EventAnnounce;
