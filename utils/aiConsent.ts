import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder,
  type Message,
} from 'discord.js';
import { logError } from './log';

/**
 * Version of the data notice below. **Bump this whenever the wording changes in
 * a way that changes what the user is agreeing to** — stored acceptances carry
 * the version they were given, so a bump re-prompts everyone. Cosmetic edits
 * (typos, formatting) don't need one.
 */
export const AI_CONSENT_VERSION = 1;

const ACCEPT_ID = 'ai_consent_accept';
const DECLINE_ID = 'ai_consent_decline';

/** How long the buttons stay live before the prompt gives up. */
const CONSENT_TIMEOUT_MS = 120_000;

/**
 * The notice itself. Deliberately concrete about the three things a member
 * can't see from the outside: their text leaves the bot, it is kept, and
 * replying to someone else pulls that person's message along with it.
 */
export function buildConsentEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('Before you chat with the AI')
    .setDescription(
      'This is a one-time notice — accept it once and you won\'t be asked again.',
    )
    .addFields(
      {
        name: 'Where your messages go',
        value: 'What you send is passed to third-party AI providers (via OpenRouter) '
          + 'to generate a reply. It leaves this server and the club does not control '
          + 'what those providers do with it.',
      },
      {
        name: 'What gets kept',
        value: 'Your conversation is stored in the bot\'s database so the AI can '
          + 'remember context, along with a record of your token usage. '
          + 'Use `/ai chatdelete` to clear a conversation.',
      },
      {
        name: 'What gets included',
        value: 'If you reply to another message, or use `/summary`, other people\'s '
          + 'messages from this channel are sent along with yours.',
      },
      {
        name: '⚠ Keep it non-sensitive',
        value: '**Do not enter anything you would not be happy to see made public** — '
          + 'no passwords, student IDs, personal details, unpublished assessment '
          + 'work, or anything covered by UWA academic-misconduct rules.',
      },
    )
    .setFooter({ text: 'Declining just means no AI reply — nothing else changes.' });
}

function buildButtons(disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ACCEPT_ID)
      .setLabel('I understand')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(DECLINE_ID)
      .setLabel('No thanks')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

/** Delivers the prompt and hands back the message its buttons live on. */
export type ConsentSender = (payload: {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}) => Promise<Message>;

/**
 * Gate every AI entry point behind a one-time acknowledgement.
 *
 * Returns true when the user may proceed — either they had already accepted the
 * current notice version, or they just pressed accept. Returns false on
 * decline, timeout, or a failure to deliver the prompt; callers must treat
 * false as "stop, and say nothing further", since this function has already put
 * the explanation on screen.
 *
 * The DB read is cached in AiConsentModel, so the steady-state cost on the hot
 * path (every message that mentions Marv) is a Map lookup.
 */
export async function ensureAiConsent(
  db: any,
  userId: string,
  send: ConsentSender,
): Promise<boolean> {
  try {
    if (await db.aiConsent.hasConsented(userId, AI_CONSENT_VERSION)) return true;
  } catch (err) {
    // A consent check that can't read the DB must fail closed: without a
    // recorded acceptance we have no basis to send anything to a provider.
    logError('AiConsent: consent lookup failed, refusing generation:', err);
    return false;
  }

  let prompt: Message;
  try {
    prompt = await send({ embeds: [buildConsentEmbed()], components: [buildButtons()] });
  } catch (err) {
    logError('AiConsent: failed to deliver the consent prompt:', err);
    return false;
  }

  try {
    const press = await prompt.awaitMessageComponent({
      componentType: ComponentType.Button,
      // Only the person who triggered the AI can answer for themselves. A
      // rejected filter never acknowledges the press, so Discord would show the
      // bystander "This interaction failed" after three seconds — reply to them
      // ephemerally instead, then reject.
      filter: (i) => {
        if (i.user.id === userId) return true;
        i.reply({
          content: 'This notice is for someone else — mention the AI yourself to get your own.',
          ephemeral: true,
        }).catch((e) => { logError('AiConsent: failed to wave off a foreign button press:', e); });
        return false;
      },
      time: CONSENT_TIMEOUT_MS,
    });

    if (press.customId === DECLINE_ID) {
      await press.update({
        embeds: [new EmbedBuilder()
          .setColor('#99AAB5')
          .setTitle('No problem')
          .setDescription('The AI won\'t reply to you. Mention it again any time to see this notice.')],
        components: [],
      });
      return false;
    }

    const stored = await db.aiConsent.record(userId, AI_CONSENT_VERSION);
    if (!stored) {
      await press.update({
        embeds: [new EmbedBuilder()
          .setColor('#ED4245')
          .setTitle('Couldn\'t save that')
          .setDescription('Your acceptance didn\'t save — please try again in a moment.')],
        components: [],
      });
      return false;
    }

    await press.update({
      embeds: [new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('Thanks — you\'re all set')
        .setDescription('Working on your message now. Remember: nothing sensitive.')],
      components: [],
    });
    return true;
  } catch {
    // awaitMessageComponent rejects on timeout. Clear the buttons so a stale
    // prompt can't be accepted an hour later out of context.
    await prompt.edit({ embeds: [buildConsentEmbed()], components: [buildButtons(true)] })
      .catch((e) => { logError('AiConsent: failed to disable a timed-out prompt:', e); });
    return false;
  }
}
