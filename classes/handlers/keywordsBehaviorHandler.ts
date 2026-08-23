import {
  EmbedBuilder, type Message,
} from 'discord.js';
import { log, logError } from '../../utils/log';
import {
  resolvePersona,
  generateContent,
  generateTitleForHistory,
  getPersonaMediaKinds,
  resolveTurnModel,
} from '../../utils/ai';
import { ensureAiConsent } from '../../utils/aiConsent';
import { getRateLimitErrorMessage } from '../../utils/discordRateLimit';
import { IMAGE_GEN_TOOL_NAME, IMAGE_EDIT_MAX_SOURCES } from '../../utils/imageGen';
import { MUSIC_GEN_TOOL_NAME, MUSIC_GUIDE_TOOL_NAME } from '../../utils/musicGen';
import { DIAGRAM_GEN_TOOL_NAME, DIAGRAM_GUIDE_TOOL_NAME } from '../../utils/diagramGen';
import { CLUB_TOOL_NAMES, perthDateString } from '../../utils/clubInfo';
import { parseNewSessionFlag } from '../../utils/sessionFlag';
import { trimHistoryToFit } from '../../utils/tokenizer';
import { extractPdfsFromMessage } from '../../utils/pdf';
import {
  collectMediaFromMessage, hasQualifyingMedia, tryAcquireMediaSlot, releaseMediaSlot,
  type MediaKind,
} from '../../utils/aiMedia';
import {
  isModerationEnabled, moderateExchange, moderateGeneratedImages,
  MODERATION_PAUSED_MESSAGE, MODERATION_BLOCKED_MESSAGE,
  type ModerationVerdict,
} from '../../utils/aiModeration';
import { withAiSessionLock } from '../../utils/aiSessionLock';

/**
 * Replies are sent as the bot itself. Marv *is* this bot, so there is no
 * webhook impersonation any more: the answer arrives as a native Discord reply
 * to the message that summoned him, which is also what threads the conversation
 * and gives the jump-back link the old link buttons had to fake.
 */
const scriptHandlers = {
  marv: async (message: Message): Promise<void> => {
    const username = message.author?.username
      ? message.author.username.toLowerCase()
      : 'user';

    // One-time data notice, before anything is read, stored, or sent onward —
    // that ordering is the point, so a declining user's attachments are never
    // even downloaded. Steady state is a cached Map lookup (AiConsentModel).
    const consented = await ensureAiConsent(
      (message.client as any).db,
      message.author.id,
      (payload) => message.reply({ ...payload, allowedMentions: { repliedUser: false } }),
    );
    if (!consented) return;

    // `-n` requests a fresh session and is stripped before the model sees it.
    const { requested: shouldStartNewSession, text: query } = parseNewSessionFlag(message.content || '');

    const contextMsg = message.reference
      ? await message.channel.messages
        .fetch(message.reference.messageId!)
        .catch(() => null)
      : null;

    const persona = await resolvePersona(query);
    const displayName = persona.name;

    const NO_MEMORY_PERSONAS = ['Summarizer'];
    const hasMemory = !NO_MEMORY_PERSONAS.includes(displayName);

    // Read once, up front: `ai_moderation` is a master switch, so every
    // moderation-aware branch below must agree on its value within a message.
    const moderationOn = await isModerationEnabled((message.client as any).db);

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
    // Images the *sender* attached, for the content-safety pre-screen. Same
    // buffers as above — screening never re-downloads.
    let moderationImageParts: any[] = [];
    let mediaPlaceholders: string[] = [];
    let editOnlyPlaceholders: string[] = [];
    const mediaNotices: string[] = [];
    let mediaSlotHeld = false;
    // Modalities this persona's model can read — Marv's vision route takes
    // images only. Anything outside this set is collected only if the
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
            fromReply: collected.fromReply[i],
            placeholder: collected.placeholders[i],
          }));
          // Only the sender's own images, for the same reason `ownTurnText`
          // drops quoted text: an image pulled in from the replied-to message
          // isn't theirs, and pausing their session over it would hand anyone a
          // way to get a conversation killed. The output screen still catches
          // whatever the model says about it.
          moderationImageParts = items
            .filter((m) => m.kind === 'image' && !m.fromReply)
            .map((m) => m.part);
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
          moderationImageParts = [];
          mediaPlaceholders = [];
          editOnlyPlaceholders = [];
        }
      }
    }

    for (const notice of [...pdfNotices, ...mediaNotices]) {
      await message.reply({ content: notice, allowedMentions: { repliedUser: false } })
        .catch((e) => { logError('Attachment notice reply failed:', e); });
    }
    const pdfPrefix = pdfBlocks.length > 0 ? `${pdfBlocks.join('\n\n')}\n\n` : '';
    const allPlaceholders = [...mediaPlaceholders, ...editOnlyPlaceholders];
    const mediaSuffix = allPlaceholders.length > 0 ? `\n${allPlaceholders.join('\n')}` : '';

    // Tag every prompt with who is speaking and what club role they hold, so the
    // persona knows whether it's talking to the Treasurer or a random member. A
    // roster lookup failure must never cost us the reply.
    let speakerTitle = 'Ordinary Member';
    if (message.guild) {
      try {
        const titles = await (message.client as any).db.committee
          .getTitlesForUser(message.guild.id, message.author.id);
        if (titles.length > 0) speakerTitle = titles.join(' / ');
      } catch (titleErr) {
        logError('Committee: failed to look up speaker title, defaulting to Ordinary Member:', titleErr);
      }
    }
    const metaPrefix = `[${perthDateString()}]-[${speakerTitle}]-[${username}]-`;

    let prompt = '';

    if (contextMsg) {
      // Replies are the bot's own messages now, so identity is the bot's user
      // id rather than a webhook username match.
      const promptName = (contextMsg.author.id === message.client.user?.id) ? 'You' : contextMsg.author.username;
      prompt = `${pdfPrefix}Previous message by ${promptName}: "${contextMsg.content}"

      ${metaPrefix}User ${username} said: ${query}${mediaSuffix}`;
    } else {
      prompt = `${pdfPrefix}${metaPrefix}User ${username} said: ${query}${mediaSuffix}`;
    }

    // What the *user themselves* wrote, with no quoted reply context and no PDF
    // body. This — not `prompt` — is what the content-safety screen judges for
    // the purpose of pausing: `prompt` embeds another user's message when this
    // is a reply, so screening it would let someone permanently pause a third
    // party's session just by being quoted at. The model's reply is still
    // post-screened, which is where content induced by quoted context surfaces.
    const ownTurnText = `User ${username} said: ${query}`;

    log(`Prompt: ${prompt}`);

    let aiSession = null;
    let history: any[] = [];
    let historyLoaded = false;
    let hadRawHistory = false;
    let contextWarnings: { level: number; message: string; wasTrimmed: boolean; trimmedCount: number }[] = [];
    // Kept so the text-only fallback below can re-trim from the untrimmed set
    // rather than from a window budgeted for a different model.
    let filteredHistory: any[] = [];
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
        filteredHistory = rawHistory.filter((h: { role: string }) => h.role !== 'tool');

        // Token-based sliding window: trim oldest messages to fit context.
        // Budgeted against the model this turn will actually run on — a dual-
        // routed persona's two models can have different context windows, and
        // the text model's can be the smaller of the two (Marv: 262k on
        // DeepSeek against 1.05M on the vision route). A vision turn that falls
        // back to text-only therefore re-trims against the text budget before
        // retrying; see the catch below.
        const { trimmedHistory, warnings } = await trimHistoryToFit(
          persona.provider,
          resolveTurnModel(persona, mediaParts.length > 0).model,
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

    // The whole turn — pause check, generation, delivery and history writes —
    // runs under a per-session lock. Those are separate operations, so without
    // serialization a concurrent turn could flag the session in between and this
    // one would still deliver into a paused chat. Memoryless personas have no
    // session to lock and nothing to persist, so they run unserialized.
    const runTurn = async () => {
      // Content-safety gate (global `ai_moderation` switch). Applies to every
      // persona and every user alike. Releases the media slot on every exit —
      // the normal path frees it in the generation `finally` below.
      //
      // `flagAndNotify` is the single exit for every trip, so the cleanup, the
      // flag write and the notice can never drift apart. `verdict` is omitted
      // when the session was already flagged by an earlier turn (nothing to
      // re-record).
      const flagAndNotify = async (verdict?: ModerationVerdict) => {
        if (mediaSlotHeld) {
          releaseMediaSlot();
          mediaSlotHeld = false;
        }
        mediaParts = [];
        imageEditParts = [];
        moderationImageParts = [];
        if (aiSession && verdict) {
          try {
            const flagged = await (message.client as any).db.aiChat.flagSessionModeration(
              aiSession.sessionId,
              verdict.categories,
            );
            // The turn is refused either way — but an unflagged session would let
            // the *next* message through, so this must be loud.
            if (!flagged) {
              logError(`AiChat: content-safety pause did not persist for session ${aiSession.sessionId}; session may resume`);
            }
          } catch (flagErr) {
            logError('AiChat: Failed to flag session for moderation:', flagErr);
          }
        }
        // A memoryless persona has no session to pause — say "blocked", not
        // "start a new chat".
        const notice = aiSession ? MODERATION_PAUSED_MESSAGE : MODERATION_BLOCKED_MESSAGE;
        await message.reply({ content: notice, allowedMentions: { repliedUser: false } })
          .catch((e) => { logError('AiChat: moderation notice reply failed:', e); });
      };

      /**
       * Current pause state, read inside the lock. `aiSession` was captured
       * before the lock was acquired, so a turn queued behind one that paused
       * the session would not see the flag on that snapshot.
       */
      const isPausedNow = async (): Promise<boolean> => {
        if (!moderationOn || !aiSession) return false;
        const fresh = await (message.client as any).db.aiChat.getSessionById(aiSession.sessionId);
        return !!fresh?.moderationFlagged;
      };

      if (moderationOn) {
        // Already paused: refuse before spending anything at all.
        if (await isPausedNow()) {
          await flagAndNotify();
          return;
        }

        // Pre-screen the user's own text and attached images so an unsafe
        // prompt never reaches (or bills) the chat model. Quoted context, PDF
        // bodies and images from the replied-to message are excluded — see
        // `ownTurnText` and `moderationImageParts`.
        const inboundVerdict = await moderateExchange(ownTurnText, undefined, moderationImageParts);
        if (!inboundVerdict.safe) {
          await flagAndNotify(inboundVerdict);
          return;
        }
      }

      try {
        // Dual routing: attachments the chat model must see force the persona's
        // vision model, everything else takes the cheap default. `withMedia` is
        // the whole input — the text-only retry below therefore also drops back to
        // the text model instead of paying vision prices for a text turn.
        const generateOnce = (withMedia: boolean) => generateContent({
          db: (message.client as any).db,
          userId: message.author.id,
          provider: persona.provider,
          ...resolveTurnModel(persona, withMedia),
          systemPrompt: persona.systemPrompt ?? '',
          prompt,
          history,
          webSearchEnabled: persona.webSearchEnabled,
          mediaParts: withMedia ? mediaParts : [],
          // Image generation is Discord-only (delivery rides this reply); the
          // rate limit is keyed to the requesting Discord user. Attached images
          // ride along as edit sources for the generate_image tool. The
          // self-portrait reference rides the same clubTools gate as Marv's other
          // extras — it's his avatar, so no other persona should draw "itself".
          imageGen: hasMemory
            ? {
              userId: message.author.id,
              db: (message.client as any).db,
              imageParts: imageEditParts,
              selfPortrait: persona.clubTools === true,
            }
            : undefined,
          // Music generation rides the same reply delivery; rate limit keyed
          // to the requesting Discord user.
          musicGen: hasMemory
            ? { userId: message.author.id, db: (message.client as any).db }
            : undefined,
          // Diagram rendering rides the same reply delivery; rate limit keyed
          // to the requesting Discord user.
          diagramGen: hasMemory
            ? { userId: message.author.id, db: (message.client as any).db }
            : undefined,
          // Club data (constitution, roster, events) is per-guild and only offered
          // to personas that opt in — currently Marv.
          club: (persona.clubTools && message.guild)
            ? { db: (message.client as any).db, guildId: message.guild.id }
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
          // The history above was trimmed to the vision model's window. Retrying
          // on a text model with a smaller one would resend an oversized request
          // and fail the fallback too, so re-trim before the retry.
          if (historyLoaded) {
            try {
              const retryTrim = await trimHistoryToFit(
                persona.provider,
                resolveTurnModel(persona, false).model,
                persona.systemPrompt ?? '',
                filteredHistory,
                prompt,
                persona.webSearchEnabled,
              );
              history = retryTrim.trimmedHistory;
              contextWarnings = retryTrim.warnings;
            } catch (trimErr) {
              logError('AiChat: failed to re-trim history for the text-only retry:', trimErr);
            }
          }
          genResult = await generateOnce(false);
        } finally {
        // Buffers are only referenced by these arrays; free the slot as soon
        // as the provider round-trip is over.
          mediaParts = [];
          imageEditParts = [];
          moderationImageParts = [];
          if (mediaSlotHeld) {
            releaseMediaSlot();
            mediaSlotHeld = false;
          }
        }
        const { text, images, toolCalls } = genResult;

        // Post-screen the exchange — the classifier judges the reply with the turn
        // that produced it in context. Nothing from this turn is delivered or
        // persisted when it trips (the credits are still spent; generation has
        // already happened).
        //
        // A tool-driven turn can return generated files with empty `text`, which
        // would otherwise re-screen the prompt that already passed inbound and
        // wave the files through — so the prompts the model asked the tools for
        // are screened as part of the output text.
        if (moderationOn) {
          const generationPrompts = (toolCalls ?? [])
            .filter((tc: any) => tc.name === IMAGE_GEN_TOOL_NAME || tc.name === MUSIC_GEN_TOOL_NAME)
            .map((tc: any) => String(tc.args?.prompt ?? tc.args?.title ?? ''))
            .filter(Boolean);
          const screenedOutput = [text, ...generationPrompts].filter(Boolean).join('\n');
          const outboundVerdict = await moderateExchange(ownTurnText, screenedOutput);
          if (!outboundVerdict.safe) {
            await flagAndNotify(outboundVerdict);
            return;
          }
          // Screening the prompt is not screening the picture: an edit over an
          // attached source can turn a benign instruction into an unsafe image.
          // Only runs when this turn actually produced one; generated audio is
          // skipped inside (the classifier takes no audio).
          const imageVerdict = await moderateGeneratedImages(
            generationPrompts.join('\n'),
            images,
          );
          if (!imageVerdict.safe) {
            await flagAndNotify(imageVerdict);
            return;
          }
          // A concurrent turn may have paused this session while we were
          // generating. The conditional ADD_HISTORY already blocks persistence,
          // but delivery rides this native reply that nothing else guards —
          // without this the reply still reaches the channel of a paused chat.
          if (await isPausedNow()) {
            await flagAndNotify();
            return;
          }
        }

        // Prominent pre-reply notice when history was trimmed — so the user sees
        // it before the wall of AI text, not buried after.
        const trimWarning = contextWarnings.find((w) => w.wasTrimmed);
        if (trimWarning) {
          const trimEmbed = new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle('⚠ Context limit reached')
            .setDescription(`Trimmed **${trimWarning.trimmedCount}** old message${trimWarning.trimmedCount === 1 ? '' : 's'} to fit this model's context window. The oldest parts of the conversation are no longer visible to me.`)
            .setFooter({ text: 'Use "-n" to start a fresh session' });
          try {
            await message.reply({ embeds: [trimEmbed], allowedMentions: { repliedUser: false } });
          } catch (warnErr) {
            logError('Failed to send trim warning embed:', warnErr);
          }
        }

        const MAX_LENGTH = 2000;
        const nonSearchTools = [
          IMAGE_GEN_TOOL_NAME, MUSIC_GEN_TOOL_NAME, MUSIC_GUIDE_TOOL_NAME,
          DIAGRAM_GEN_TOOL_NAME, DIAGRAM_GUIDE_TOOL_NAME, ...CLUB_TOOL_NAMES,
        ];
        const searchCallCount = (toolCalls ?? []).filter((tc: any) => !nonSearchTools.includes(tc.name)).length;
        const imageCallHappened = (toolCalls ?? []).some((tc: any) => tc.name === IMAGE_GEN_TOOL_NAME && tc.ok);
        const musicCallHappened = (toolCalls ?? []).some((tc: any) => tc.name === MUSIC_GEN_TOOL_NAME && tc.ok);
        const diagramCallHappened = (toolCalls ?? []).some((tc: any) => tc.name === DIAGRAM_GEN_TOOL_NAME && tc.ok);
        const searchPrefix = searchCallCount > 0
          ? `-# 🔎 searched the web (${searchCallCount})\n`
          : '';
        const imagePrefix = imageCallHappened ? '-# 🎨 generated an image\n' : '';
        const musicPrefix = musicCallHappened ? '-# 🎵 composed music\n' : '';
        const diagramPrefix = diagramCallHappened ? '-# 📊 drew a diagram\n' : '';
        const mediaReadPrefix = mediaPlaceholders.length > 0 && !mediaDropped
          ? `-# 📎 read ${mediaPlaceholders.length} attachment${mediaPlaceholders.length === 1 ? '' : 's'}\n`
          : '';
        const mediaFailPrefix = mediaDropped
          ? '-# ⚠ the model rejected the attachments — answered without them\n'
          : '';
        let remainingText = `${searchPrefix}${imagePrefix}${musicPrefix}${diagramPrefix}${mediaReadPrefix}${mediaFailPrefix}${(text || '').toString()}`;
        let previousMsg: any = null;
        let filesToAttach: any[] = images || [];

        let currentChunk = remainingText.slice(0, MAX_LENGTH);
        remainingText = remainingText.slice(currentChunk.length).trimStart();

        // A native reply to the summoning message: Discord renders the jump-back
        // link itself, so the old "↩ Replying to" link button is gone. The author
        // is pinged (they asked), but `parse: []` still stops the model's own text
        // from mentioning anyone.
        const sentInitial = await message.reply({
          content: currentChunk || (filesToAttach.length > 0 ? '' : '(no content)'),
          files: filesToAttach,
          allowedMentions: { parse: [], repliedUser: true },
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

          // Each overflow chunk replies to the one before it, so a long answer
          // chains in order and Discord supplies the "⬅ Previous" jump for free.
          // No second ping: the user was already notified by the first chunk.
          const sent = await previousMsg.reply({
            content: currentChunk,
            allowedMentions: { parse: [], repliedUser: false },
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
            .setFooter({ text: 'Use "-n" to start a fresh session' });
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
        await message.reply({
          content: 'Sorry — something went wrong while I was putting that reply together. '
          + "It's usually a temporary hiccup on the AI provider's end. Please try again in a moment.",
          allowedMentions: { repliedUser: false },
        });
      }
    };

    if (aiSession) await withAiSessionLock(aiSession.sessionId, runTurn);
    else await runTurn();
  },
};

export default scriptHandlers;
