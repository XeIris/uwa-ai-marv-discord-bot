import { DevCommand } from './classes/DevCommand';
import { logError } from '../utils/log';

class Eval extends DevCommand {
  constructor(client: any) {
    super(client, 'eval', 'evaluate js code. most dangerous command???', [{
      name: 'code',
      description: 'js code',
      type: 3,
      required: true,
    }], { blame: 'ei' });
  }

  async run(interaction: any): Promise<void> {
    const input = interaction.options.getString('code');
    try {
      // eslint-disable-next-line no-eval
      interaction.editReply(`${eval(input)}`);
    } catch (error) {
      logError('Error evaluating code:', error);
      interaction.editReply(`Error: ${(error as Error).message}`);
    }
  }
}

export default Eval;
