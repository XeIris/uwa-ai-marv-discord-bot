import { DevCommand } from './classes/DevCommand';

class PingDev extends DevCommand {
  constructor(client: any) {
    super(client, 'dev', 'pong but for dev', [], { isSubcommandOf: 'ping', blame: 'ei' });
  }

  async run(interaction: any): Promise<void> {
    await interaction.editReply('Pong!');
  }
}

export default PingDev;
