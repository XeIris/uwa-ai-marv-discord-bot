import { CommandGroup } from '../classes/commandGroup';

export default class Dev extends CommandGroup {
  constructor(client: any) {
    super(client, 'dev', 'Developer commands', ['ramstats']);
  }
}
