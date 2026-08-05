import { EmbedBuilder } from 'discord.js';
import { Command } from './classes/Command';

class Blame extends Command {
  constructor(client: any) {
    super(client, 'blame', 'spam ping the author of a command', [
      {
        name: 'command',
        description: 'the name of the command to blame',
        type: 3,
        required: true,
      },
    ], { blame: 'ei' });
  }

  async run(interaction: any): Promise<void> {
    let commandName = interaction.options.getString('command');
    commandName = commandName.toLowerCase().replace(/ /g, '.');

    const command = this.client.commands.get(commandName);

    if (!command) {
      await interaction.editReply({ content: 'command not found' });
      return;
    }

    switch (command.blame) {
      case 'ei':
        await this.sendEmbed(interaction, 'ei', commandName);
        await this.spamPing(interaction, '595491647132008469');
        break;
      case 'xei':
        await this.sendEmbed(interaction, 'xei', commandName);
        await this.spamPing(interaction, '964521557823197184');
        break;
      case 'both':
        await this.sendEmbed(interaction, 'both', commandName);
        await this.spamPing(interaction, '595491647132008469');
        await this.spamPing(interaction, '964521557823197184');
        break;
      default:
        await interaction.editReply({ content: 'command dev not found' });
        break;
    }
  }

  async spamPing(interaction: any, uid: string): Promise<void> {
    for (let i = 1; i <= 5; i += 1) {
      setTimeout(() => {
        interaction.followUp({ content: `<@${uid}>` });
      }, i * 1000);
    }
  }

  async sendEmbed(interaction: any, name: string, commandName: string): Promise<void> {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor('#00AA00')
        .setTitle(`blame ${name} for ${commandName}`),
      ],
    });
  }
}

export default Blame;
