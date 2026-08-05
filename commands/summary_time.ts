import { EmbedBuilder } from 'discord.js';
import { Command } from './classes/Command';
import { generateContent, getPersonaByName } from '../utils/ai';
import { log, logError } from '../utils/log';
import { handleRateLimitError } from '../utils/discordRateLimit';
import { fetchMessagesByTime } from '../utils/fetch';

function splitForEmbed(text: string, max = 4096): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    let end = remaining.lastIndexOf('\n', max);
    if (end <= 0) end = remaining.lastIndexOf(' ', max);
    if (end <= 0) end = max;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end).replace(/^\s+/, '');
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

class Summary extends Command {
  constructor(client: any) {
    super(client, 'time', 'Summarize messages from the last n hours/minutes', [
      {
        name: 'hours',
        description: 'The number of hours',
        type: 4,
        required: true,
      },
      {
        name: 'minutes',
        description: 'The number of minutes',
        type: 4,
        required: false,
      },
    ], { isSubcommandOf: 'summary', blame: 'ei' });
  }

  async run(interaction: any): Promise<void> {
    const hours = interaction.options.getInteger('hours');
    const minutes = interaction.options.getInteger('minutes') || 0;
    const totalMinutes = hours * 60 + minutes;
    const timeLimit = new Date(Date.now() - totalMinutes * 60 * 1000);

    if (totalMinutes <= 0) {
      await interaction.editReply('Invalid time range. Please enter a number greater than 0 minutes.');
      return;
    }
    if (totalMinutes > 72 * 60) {
      await interaction.editReply('Invalid time range. Maximum is 72 hours.');
      return;
    }

    const messages = await fetchMessagesByTime(interaction.channel, timeLimit.getTime(), 3000);
    log(`Fetched ${messages.length} messages`);

    if (messages.length === 0) {
      await interaction.editReply(`No messages found in the last ${Math.floor(totalMinutes / 60)} hours and ${totalMinutes % 60} minutes.`);
      return;
    }

    const content = `Summarizing ${messages.length} messages.\n\n${messages.map((message: any) => `Message by ${message[1].author.username}: ${message[1].content}`).join('\n')}`;
    const persona = await getPersonaByName('Summarizer');
    if (!persona) {
      await interaction.editReply('Summarizer persona not configured.');
      return;
    }
    if (persona.systemPromptFile) {
      persona.systemPrompt = await Bun.file(persona.systemPromptFile).text();
    }

    let summary: any;
    try {
      summary = await generateContent({
        db: this.client.db,
        userId: interaction.user.id,
        provider: persona.provider,
        model: persona.model,
        systemPrompt: persona.systemPrompt ?? '',
        prompt: content,
      });
      log(`Generated summary: ${summary.text}`);
    } catch (error: any) {
      if (error?.message === 'RATE_LIMIT_EXCEEDED') {
        await handleRateLimitError(interaction, this.client.db, {
          reason: error.reason,
          reservedCredits: error.reservedCredits,
          remainingCredits: error.remainingCredits,
        });
        return;
      }
      logError('Failed to generate summary:', error);
      await interaction.editReply('Failed to generate summary. Please try again later.');
      return;
    }

    const chunks = splitForEmbed(summary.text);
    await interaction.editReply(
      {
        embeds: [
          new EmbedBuilder()
            .setTitle(`Summary of${messages.length === 3000 ? ' the last' : ''} ${messages.length} messages from the last ${Math.floor(totalMinutes / 60)} hours and ${totalMinutes % 60} minutes`)
            .setDescription(chunks[0]),
        ],
      },
    );
    for (let i = 1; i < chunks.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await interaction.followUp({
        embeds: [new EmbedBuilder().setDescription(chunks[i])],
      });
    }
  }
}

export default Summary;
