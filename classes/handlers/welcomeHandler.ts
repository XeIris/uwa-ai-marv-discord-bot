/**
 * Posts the welcome card when someone joins.
 *
 * **Welcomes are off unless a server opts in** by setting the `welcome_channels`
 * channel list (`/serverconfig setchannel`). Nothing is DM'd and no "general"
 * channel is guessed: an unconfigured guild is silent, same rule the event
 * reminders follow.
 *
 * The card itself is rendered by `utils/welcomeCard.ts`. If that fails — missing
 * fonts, a bad render — the greeting still goes out without the image, because a
 * new member being told where the roles are matters more than the picture.
 *
 * There's deliberately no dedupe/claim machinery here, unlike the event
 * scheduler. `guildMemberAdd` is an edge-triggered gateway event, not a periodic
 * sweep, so there's no window in which a restart replays old joins.
 */

import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { log, logError } from '../../utils/log';
import { loadResolvedServerConfig } from '../../utils/serverConfig';
import { renderWelcomeCard, WELCOME_EMBED_COLOUR } from '../../utils/welcomeCard';

const CARD_FILENAME = 'welcome.png';

/** The greeting itself. `mention` is a `<@id>` so the new member gets pinged. */
export function welcomeMessage(mention: string): string {
  return `Hello ${mention}. You can add roles for your AI interests on the Channels and Roles page at the top! `
    + 'Also check the announcements channel for our latest events.';
}

export interface WelcomePayload {
  content: string;
  embeds: EmbedBuilder[];
  files: AttachmentBuilder[];
}

/**
 * Builds the welcome message — greeting, embed, and the card as an attachment
 * the embed displays inline via `attachment://`.
 *
 * Shared by the join handler and `/dev welcome_test` so the test command
 * rehearses the real thing rather than an approximation of it.
 */
export async function buildWelcomePayload(member: {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}): Promise<WelcomePayload> {
  const embed = new EmbedBuilder().setColor(WELCOME_EMBED_COLOUR);

  const png = await renderWelcomeCard({
    displayName: member.displayName,
    avatarUrl: member.avatarUrl,
  });

  const files: AttachmentBuilder[] = [];
  if (png) {
    files.push(new AttachmentBuilder(png, { name: CARD_FILENAME }));
    embed.setImage(`attachment://${CARD_FILENAME}`);
  } else {
    // An embed with neither image nor description renders as an empty box.
    embed.setDescription(`Welcome to UWA AI Club, **${member.displayName}**!`);
  }

  return { content: welcomeMessage(`<@${member.id}>`), embeds: [embed], files };
}

/**
 * Handles `guildMemberAdd`: renders the card once and posts it to every
 * configured welcome channel.
 */
export async function handleGuildMemberAdd(client: any, member: any): Promise<void> {
  try {
    if (member.user?.bot) return;

    const guildId = member.guild?.id;
    if (!guildId) return;

    const config = await loadResolvedServerConfig(client.db, guildId);
    if (config.welcomeChannelIds.length === 0) return;

    const payload = await buildWelcomePayload({
      id: member.id,
      displayName: member.displayName ?? member.user?.username ?? 'new member',
      avatarUrl: member.displayAvatarURL?.({ extension: 'png', size: 512 }) ?? null,
    });

    let delivered = 0;
    for (const channelId of config.welcomeChannelIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased?.()) {
          log(`[welcome] channel ${channelId} in guild ${guildId} is not text-based; skipping`);
          continue;
        }
        // channels.fetch is client-wide, not guild-scoped: a stale or mistyped
        // id in this guild's config can resolve to a channel in another guild
        // the bot is in, and we would post someone's join card to strangers.
        if ((channel as { guildId?: string | null }).guildId !== guildId) {
          log(`[welcome] channel ${channelId} is not in guild ${guildId}; skipping`);
          continue;
        }
        // Rebuilt per channel: an AttachmentBuilder wraps a stream that discord.js
        // consumes on send, so re-sending the same instance uploads nothing.
        // eslint-disable-next-line no-await-in-loop
        await channel.send({
          content: payload.content,
          embeds: payload.embeds,
          files: payload.files.map((file) => new AttachmentBuilder(file.attachment as Buffer, { name: CARD_FILENAME })),
        });
        delivered += 1;
      } catch (err) {
        logError(`[welcome] failed to post welcome for ${member.id} to ${channelId}:`, err);
      }
    }

    log(`[welcome] welcomed ${member.user?.username ?? member.id} in guild ${guildId} (${delivered}/${config.welcomeChannelIds.length} channels)`);
  } catch (err) {
    logError('[welcome] guildMemberAdd handler failed:', err);
  }
}
