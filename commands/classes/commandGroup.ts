import { log } from '../../utils/log';

export class CommandGroup {
  client: any;
  name: string;
  description: string;
  commands: string[];
  isSubcommandOf: string | null;

  constructor(client: any, name: string, description: string, commands: string[]) {
    this.client = client;
    this.name = name;
    this.description = description;
    this.commands = commands;
    this.isSubcommandOf = null;
  }

  async execute(interaction: any): Promise<void> {
    const commandName = interaction.options.getSubcommand();
    log(`> Subcommand: ${commandName}`);
    const command = this.client.commands.get(`${this.name}.${commandName}`);
    if (!command) return;
    await command.execute(interaction);
  }

  toJSON(): object {
    return {
      name: this.name,
      description: this.description,
      options: this.commands.map((command) => {
        const commandClass = this.client.commands.get(`${this.name}.${command}`);
        if (!commandClass) return null;
        return {
          name: commandClass.name,
          description: commandClass.description,
          type: 1,
          options: commandClass.options,
        };
      }).filter(Boolean),
    };
  }
}
