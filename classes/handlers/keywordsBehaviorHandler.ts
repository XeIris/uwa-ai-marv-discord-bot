import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Message,
  type TextChannel,
} from 'discord.js';
import { log, logError } from '../../utils/log';
import {
  resolvePersona,
  generateContent,
  generateTitleForHistory,
  getPersonaMediaKinds,
} from '../../utils/ai';
import { getRateLimitErrorMessage } from '../../utils/discordRateLimit';
import { IMAGE_GEN_TOOL_NAME, IMAGE_EDIT_MAX_SOURCES } from '../../utils/imageGen';
import { MUSIC_GEN_TOOL_NAME, MUSIC_GUIDE_TOOL_NAME } from '../../utils/musicGen';
import { trimHistoryToFit } from '../../utils/tokenizer';
import { extractPdfsFromMessage } from '../../utils/pdf';
import {
  collectMediaFromMessage, hasQualifyingMedia, tryAcquireMediaSlot, releaseMediaSlot,
  type MediaKind,
} from '../../utils/aiMedia';

const WEBHOOK_NAME = process.env.WEBHOOK_NAME || 'grok-webhook';

const scriptHandlers = {
  grok: async (message: Message): Promise<void> => {
    const username = message.author?.username
      ? message.author.username.toLowerCase()
      : 'user';
    const query = message.content || '';
    const shouldStartNewSession = /\bkys\b/i.test(query);

    const contextMsg = message.reference
      ? await message.channel.messages
        .fetch(message.reference.messageId!)
        .catch(() => null)
      : null;

    const persona = await resolvePersona(query);
    const displayName = persona.name;

    const NO_MEMORY_PERSONAS = ['Summarizer'];
    const hasMemory = !NO_MEMORY_PERSONAS.includes(displayName);

    if (shouldStartNewSession && hasMemory) {
      try {
        const newSession = await (message.client as any).db.aiChat.startNewSession(
          message.author.id,
          displayName,
        );

        const startedEmbed = new EmbedBuilder()
          .setColor('#57F287')
          .setTitle('New Session Started')
          .setDescription(
            `Started a new **${displayName}** chat session: **#${newSession.sessionId}**.\n`
            + 'Send your next message to begin the new conversation.',
          );

        await message.reply({ embeds: [startedEmbed] });
      } catch (sessionErr) {
        logError('AiChat: Failed to start new session from mention handler:', sessionErr);
        await message.reply('Failed to start a new conversation. Please try again.');
      }
      return;
    }

    const { blocks: pdfBlocks, notices: pdfNotices } = await extractPdfsFromMessage(message);

    // Media (image/video/audio) attachments. Two consumers:
    //  - vision input (mediaParts → the chat model's user turn): persona-gated
    //    by the model's own input modalities (mediaInput), openrouter-only;
    //  - image editing (imageEditParts → the generate_image tool as edit
    //    sources): any persona with imageGen enabled, images only.
    // Base64 buffers live in these arrays for the duration of this generation
    // and are never persisted; only text placeholders enter the prompt/history.
    let mediaParts: any[] = [];
    let imageEditParts: any[] = [];
    let mediaPlaceholders: string[] = [];
    let editOnlyPlaceholders: string[] = [];
    const mediaNotices: string[] = [];
    let mediaSlotHeld = false;
    // Modalities this persona's model can read (e.g. MiMo: all three; Grok /
    // GPT: images only). Anything outside this set is collected only if the
    // generate_image edit path can still use it.
    const visionKinds = getPersonaMediaKinds(persona);
    const imageGenEnabled = hasMemory;
    const collectKinds = [...new Set<MediaKind>([
      ...visionKinds,
      ...(imageGenEnabled ? ['image' as MediaKind] : []),
    ])];
    const shouldCollectMedia = collectKinds.length > 0
      && hasQualifyingMedia(message, contextMsg, collectKinds);
    if (shouldCollectMedia) {
      if (!tryAcquireMediaSlot()) {
        mediaNotices.push('⚠ Too many attachment-reading requests in flight right now — answering without your attachments. Try again in a moment.');
      } else {
        mediaSlotHeld = true;
        try {
          const collected = await collectMediaFromMessage(message, contextMsg, collectKinds);
          const items = collected.parts.map((part: any, i: number) => ({
            part,
            kind: collected.kinds[i],
            placeholder: collected.placeholders[i],
          }));
          if (imageGenEnabled) {
            imageEditParts = items.filter((m) => m.kind === 'image').map((m) => m.part);
          }
          // Split by what the chat model can actually read.
          const readable = items.filter((m) => visionKinds.includes(m.kind));
          const unreadable = items.filter((m) => !visionKinds.includes(m.kind));
          mediaParts = readable.map((m) => m.part);
          mediaPlaceholders = readable.map((m) => m.placeholder);
          // The chat model can't see the rest (always images — nothing else is
          // collected for a model that can't read it) — placeholders tell it
          // they exist so it can offer/perform edits via generate_image. Only
          // IMAGE_EDIT_MAX_SOURCES images are editable (tool hard cap), so with
          // more the placeholders stay plain and the system note tells the
          // model to refuse edits.
          editOnlyPlaceholders = imageEditParts.length <= IMAGE_EDIT_MAX_SOURCES
            ? unreadable.map(
              (m) => `${m.placeholder} (you cannot view this image, but your generate_image tool can edit it)`,
            )
            : unreadable.map((m) => `${m.placeholder} (you cannot view this image)`);
          mediaNotices.push(...collected.notices);
        } catch (mediaErr) {
          logError('AiChat: media collection failed, proceeding without attachments:', mediaErr);
          mediaNotices.push('⚠ Couldn\'t process your attachments — answering without them.');
          mediaParts = [];
          imageEditParts = [];
          mediaPlaceholders = [];
          editOnlyPlaceholders = [];
        }
      }
    }

    for (const notice of [...pdfNotices, ...mediaNotices]) {
      // eslint-disable-next-line no-await-in-loop
      await message.reply({ content: notice, allowedMentions: { repliedUser: false } })
        .catch((e) => { logError('Attachment notice reply failed:', e); });
    }
    const pdfPrefix = pdfBlocks.length > 0 ? `${pdfBlocks.join('\n\n')}\n\n` : '';
    const allPlaceholders = [...mediaPlaceholders, ...editOnlyPlaceholders];
    const mediaSuffix = allPlaceholders.length > 0 ? `\n${allPlaceholders.join('\n')}` : '';

    let prompt = '';

    if (contextMsg) {
      const promptName = (contextMsg.author.username === displayName) ? 'You' : contextMsg.author.username;
      prompt = `${pdfPrefix}Previous message by ${promptName}: "${contextMsg.content}"

      User ${username} said: ${query}${mediaSuffix}`;
    } else {
      prompt = `${pdfPrefix}User ${username} said: ${query}${mediaSuffix}`;
    }

    log(`Prompt: ${prompt}`);

    const avatarURL = persona.avatarURL || message.client.user!.displayAvatarURL();

    let aiSession = null;
    let history: any[] = [];
    let historyLoaded = false;
    let hadRawHistory = false;
    let contextWarnings: { level: number; message: string; wasTrimmed: boolean; trimmedCount: number }[] = [];
    if (hasMemory) {
      try {
        aiSession = await (message.client as any).db.aiChat.getOrCreateSession(
          message.author.id,
          displayName,
        );
        const rawHistory = await (message.client as any).db.aiChat.getHistory(aiSession.sessionId, 100);
        hadRawHistory = rawHistory.length > 0;

        // Tool rows are audit-only and get filtered out before replay anyway —
        // exclude them from the token budget so they don't crowd out real turns.
        const filteredHistory = rawHistory.filter((h: { role: string }) => h.role !== 'tool');

        // Token-based sliding window: trim oldest messages to fit context
        const { trimmedHistory, warnings } = await trimHistoryToFit(
          persona.provider,
          persona.model,
          persona.systemPrompt ?? '',
          filteredHistory,
          prompt,
          persona.webSearchEnabled,
        );
        history = trimmedHistory;
        contextWarnings = warnings;
        historyLoaded = true;

        if (filteredHistory.length !== trimmedHistory.length) {
          log(`AiChat: Trimmed history from ${filteredHistory.length} to ${trimmedHistory.length} messages for session ${aiSession.sessionId}`);
        }
      } catch (histErr) {
        logError('AiChat: Failed to load history, proceeding without it:', histErr);
      }
    }

    try {
      const webhooks = await (message.channel as TextChannel).fetchWebhooks();
      let webhook = webhooks.find((wh: any) => wh.name === WEBHOOK_NAME && wh.token);

      const generateOnce = (withMedia: boolean) => generateContent({
        db: (message.client as any).db,
        userId: message.author.id,
        provider: persona.provider,
        model: persona.model,
        systemPrompt: persona.systemPrompt ?? '',
        prompt,
        history,
        webSearchEnabled: persona.webSearchEnabled,
        mediaParts: withMedia ? mediaParts : [],
        providerRouting: persona.providerRouting,
        // Image generation is Discord-only (delivery rides this webhook); the
        // rate limit is keyed to the requesting Discord user. Attached images
        // ride along as edit sources for the generate_image tool.
        imageGen: hasMemory
          ? { userId: message.author.id, db: (message.client as any).db, imageParts: imageEditParts }
          : undefined,
        // Music generation rides the same webhook delivery; rate limit keyed
        // to the requesting Discord user.
        musicGen: hasMemory
          ? { userId: message.author.id, db: (message.client as any).db }
          : undefined,
      });

      let genResult;
      let mediaDropped = false;
      try {
        genResult = await generateOnce(mediaParts.length > 0);
      } catch (genErr: any) {
        if (genErr?.message === 'RATE_LIMIT_EXCEEDED') throw genErr;
        // A provider rejecting the media (bad codec, too long, …) shouldn't eat
        // the whole reply — drop attachments and answer text-only.
        if (mediaParts.length === 0) throw genErr;
        logError('AiChat: generation with media failed, retrying text-only:', genErr);
        mediaDropped = true;
        genResult = await generateOnce(false);
      } finally {
        // Buffers are only referenced by these arrays; free the slot as soon
        // as the provider round-trip is over.
        mediaParts = [];
        imageEditParts = [];
        if (mediaSlotHeld) {
          releaseMediaSlot();
          mediaSlotHeld = false;
        }
      }
      const { text, images, toolCalls } = genResult;

      if (!webhook) {
        webhook = await (message.channel as TextChannel).createWebhook({
          name: WEBHOOK_NAME,
          avatar: avatarURL,
        });
      }

      // Prominent pre-reply notice when history was trimmed — so the user sees
      // it before the wall of AI text, not buried after.
      const trimWarning = contextWarnings.find((w) => w.wasTrimmed);
      if (trimWarning) {
        const trimEmbed = new EmbedBuilder()
          .setColor('#FEE75C')
          .setTitle('⚠ Context limit reached')
          .setDescription(`Trimmed **${trimWarning.trimmedCount}** old message${trimWarning.trimmedCount === 1 ? '' : 's'} to fit this model's context window. The oldest parts of the conversation are no longer visible to me.`)
          .setFooter({ text: 'Use "kys" to start a fresh session' });
        try {
          await message.reply({ embeds: [trimEmbed], allowedMentions: { repliedUser: false } });
        } catch (warnErr) {
          logError('Failed to send trim warning embed:', warnErr);
        }
      }

      const MAX_LENGTH = 2000;
      const nonSearchTools = [IMAGE_GEN_TOOL_NAME, MUSIC_GEN_TOOL_NAME, MUSIC_GUIDE_TOOL_NAME];
      const searchCallCount = (toolCalls ?? []).filter((tc: any) => !nonSearchTools.includes(tc.name)).length;
      const imageCallHappened = (toolCalls ?? []).some((tc: any) => tc.name === IMAGE_GEN_TOOL_NAME && tc.ok);
      const musicCallHappened = (toolCalls ?? []).some((tc: any) => tc.name === MUSIC_GEN_TOOL_NAME && tc.ok);
      const searchPrefix = searchCallCount > 0
        ? `-# 🔎 searched the web (${searchCallCount})\n`
        : '';
      const imagePrefix = imageCallHappened ? '-# 🎨 generated an image\n' : '';
      const musicPrefix = musicCallHappened ? '-# 🎵 composed music\n' : '';
      const mediaReadPrefix = mediaPlaceholders.length > 0 && !mediaDropped
        ? `-# 📎 read ${mediaPlaceholders.length} attachment${mediaPlaceholders.length === 1 ? '' : 's'}\n`
        : '';
      const mediaFailPrefix = mediaDropped
        ? '-# ⚠ the model rejected the attachments — answered without them\n'
        : '';
      let remainingText = `${searchPrefix}${imagePrefix}${musicPrefix}${mediaReadPrefix}${mediaFailPrefix}${(text || '').toString()}`;
      let previousMsg: any = null;
      let filesToAttach: any[] = images || [];

      let currentChunk = remainingText.slice(0, MAX_LENGTH);
      remainingText = remainingText.slice(currentChunk.length).trimStart();

      const componentsForFirstMessage: ActionRowBuilder<ButtonBuilder>[] = [];
      const jumpLinkToOriginal = `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
      const replyButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel(`↩ Replying to: ${username}`)
          .setStyle(ButtonStyle.Link)
          .setURL(jumpLinkToOriginal),
      );
      componentsForFirstMessage.push(replyButton);

      const sentInitial = await webhook!.send({
        content: currentChunk || (filesToAttach.length > 0 ? '' : '(no content)'),
        username: displayName,
        avatarURL,
        components: componentsForFirstMessage,
        files: filesToAttach,
        allowedMentions: { parse: [] },
      });
      previousMsg = sentInitial;
      // Discord CDN URLs of attached generated images — saved to history so the
      // model has a reference to what it sent (links are signed and expire ~24h).
      const imageCdnUrls: string[] = filesToAttach.length > 0
        ? [...(sentInitial.attachments?.values() ?? [])].map((a: any) => a.url).filter(Boolean)
        : [];
      filesToAttach = [];

      while (remainingText.length > 0) {
        currentChunk = remainingText.slice(0, MAX_LENGTH);
        const breakIndex = Math.max(
          currentChunk.lastIndexOf('\n'),
          currentChunk.lastIndexOf(' '),
        );

        if (breakIndex > 0 && remainingText.length > MAX_LENGTH) {
          currentChunk = remainingText.slice(0, breakIndex);
        }

        remainingText = remainingText.slice(currentChunk.length).trimStart();

        const componentsForFollowUp: ActionRowBuilder<ButtonBuilder>[] = [];
        const jumpLinkToPrevious = `https://discord.com/channels/${message.guildId}/${message.channelId}/${previousMsg.id}`;
        const previousButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel('⬅ Previous')
            .setStyle(ButtonStyle.Link)
            .setURL(jumpLinkToPrevious),
        );
        componentsForFollowUp.push(previousButton);

        // eslint-disable-next-line no-await-in-loop
        const sent = await webhook!.send({
          content: currentChunk,
          username: displayName,
          avatarURL,
          components: componentsForFollowUp,
          allowedMentions: { parse: [] },
        });
        previousMsg = sent;
      }

      // Post-reply context-usage embed (percentage). Skip if we only had a
      // trim-only warning — that was already shown loudly before the reply.
      const pctWarning = contextWarnings.find((w) => w.level >= 75 || (w.level >= 50 && !w.wasTrimmed));
      if (pctWarning) {
        let warningColor = '#5865F2'; // blue for 50%
        if (pctWarning.level >= 95) warningColor = '#ED4245'; // red
        else if (pctWarning.level >= 75) warningColor = '#FEE75C'; // yellow

        const warningEmbed = new EmbedBuilder()
          .setColor(warningColor as `#${string}`)
          .setDescription(pctWarning.message)
          .setFooter({ text: 'Use "kys" to start a fresh session' });
        try {
          await message.reply({ embeds: [warningEmbed], allowedMentions: { repliedUser: false } });
        } catch (warnErr) {
          logError('Failed to send context warning embed:', warnErr);
        }
      }

      const hasToolCalls = !!(toolCalls && toolCalls.length > 0);
      const hasImages = !!(images && images.length > 0);
      if (hasMemory && aiSession && (text || hasToolCalls || hasImages)) {
        const aiRole = persona.provider === 'openrouter' ? 'assistant' : 'model';
        try {
          await (message.client as any).db.aiChat.addHistory(aiSession.sessionId, 'user', prompt);
          if (hasToolCalls) {
            // Persist tool exchanges between the user message and the final assistant
            // text so chronological order is preserved. These rows are audit-only;
            // they're filtered out when history is replayed to the model.
            for (const tc of toolCalls) {
              // eslint-disable-next-line no-await-in-loop
              await (message.client as any).db.aiChat.addHistory(
                aiSession.sessionId,
                'tool',
                JSON.stringify(tc),
              );
            }
          }
          if (text) {
            await (message.client as any).db.aiChat.addHistory(aiSession.sessionId, aiRole, text);
          } else if (hasImages) {
            const imageMeta = JSON.stringify(images.map((img: any) => ({ name: img.name })));
            await (message.client as any).db.aiChat.addHistory(
              aiSession.sessionId,
              aiRole,
              `[attachment-only response] ${imageMeta}`,
            );
          }
          if (hasImages && imageCdnUrls.length > 0) {
            await (message.client as any).db.aiChat.addHistory(
              aiSession.sessionId,
              aiRole,
              `[generated file attached: ${imageCdnUrls.join(' ')}] (note: this link expires within ~24 hours)`,
            );
          }

          if (historyLoaded && !hadRawHistory && text) {
            (message.client as any).db.aiChat.getHistory(aiSession.sessionId, 100)
              .then((savedHistory: { role: string; message: string }[]) => generateTitleForHistory(savedHistory))
              .then((title: string | null) => {
                if (title) {
                  return (message.client as any).db.aiChat.updateTitle(aiSession.sessionId, title);
                }
                return undefined;
              })
              .catch((titleErr: unknown) => {
                logError('AiChat: Failed to generate session title:', titleErr);
              });
          }
        } catch (saveErr) {
          logError('AiChat: Failed to save history:', saveErr);
        }
      }
    } catch (err: any) {
      if (mediaSlotHeld) {
        releaseMediaSlot();
        mediaSlotHeld = false;
      }
      if (err?.message === 'RATE_LIMIT_EXCEEDED') {
        const db = (message.client as any).db;
        const content = await getRateLimitErrorMessage(message.author.id, db, {
          reason: err.reason,
          reservedCredits: err.reservedCredits,
          remainingCredits: err.remainingCredits,
        });
        await message.reply(content);
        return;
      }
      logError('AI unified handler error', err);
      await message.reply(
        'Either, our code is fucked, their API is fucked, or you are just fucked. Please try again later.',
      );
    }
  },
};

export default scriptHandlers;
