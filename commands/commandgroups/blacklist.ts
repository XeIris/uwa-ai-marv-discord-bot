import { CommandGroup } from '../classes/commandGroup';

export default class Blacklist extends CommandGroup {
  constructor(client: any) {
    super(client, 'blacklist', 'Blacklist commands', ['configure', 'view']);
  }
}
