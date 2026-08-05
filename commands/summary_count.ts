import { EmbedBuilder } from 'discord.js';
import { Command } from './classes/Command';
import { generateContent, getPersonaByName } from '../utils/ai';
import { log, logError } from '../utils/log';
import { handleRateLimitError } from '../utils/discordRateLimit';
import { fetchMessagesByCount } from '../utils/fetch';

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
    super(client, 'count', 'Summarize the last n messages', [
      {
        name: 'n',
        description: 'The number of past messages to summarize',
        type: 4,
        required: true,
      },
    ], { isSubcommandOf: 'summary', blame: 'ei' });
  }

  async run(interaction: any): Promise<void> {
    const count = interaction.options.getInteger('n');
    if (count < 1 || count > 3000) {
      await interaction.editReply('Invalid count. Please enter a number between 1 and 3000.');
      return;
    }

    const messages = await fetchMessagesByCount(interaction.channel, count);
    log(`Fetched ${messages.length} messages`);
    const content = `Summarizing ${messages.length} messages.\n\n${messages.map((message: any) => `Message by ${message[1].author.username}: ${message[1].content}`).join('\n')}`;
    const persona = await getPersonaByName('Summarizer');
    if (!persona) {
      await interaction.editReply('Summarizer persona not configured.');
      return;
    }
    if (persona.systemPromptFile) {
      try {
        persona.systemPrompt = await Bun.file(persona.systemPromptFile).text();
      } catch (error) {
        logError(`Failed to read system prompt file ${persona.systemPromptFile}:`, error);
        await interaction.editReply('Failed to load summarizer prompt. Please try again later.');
        return;
      }
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
            .setTitle(`Summary of ${messages.length} messages`)
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
