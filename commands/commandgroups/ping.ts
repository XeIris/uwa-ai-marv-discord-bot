import { CommandGroup } from '../classes/commandGroup';

export default class Ping extends CommandGroup {
  constructor(client: any) {
    super(client, 'ping', 'pong', ['dev']);
  }
}
