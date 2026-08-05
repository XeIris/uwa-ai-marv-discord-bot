import { CommandGroup } from '../classes/commandGroup';

export default class GlobalConfig extends CommandGroup {
  constructor(client: any) {
    super(client, 'globalconfig', 'Global config commands', ['get', 'set']);
  }
}
