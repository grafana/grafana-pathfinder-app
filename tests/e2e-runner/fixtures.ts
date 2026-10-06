import { test as base } from '../fixtures';
import { disableRudderstack } from './utils/disable-rudderstack';

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(disableRudderstack);
    await use(context);
  },
});

export { expect } from '../fixtures';
