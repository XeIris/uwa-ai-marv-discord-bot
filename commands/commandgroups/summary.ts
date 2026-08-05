import { CommandGroup } from '../classes/commandGroup';

export default class Summary extends CommandGroup {
  constructor(client: any) {
    super(client, 'summary', 'Summary commands', ['count', 'time']);
  }
}
