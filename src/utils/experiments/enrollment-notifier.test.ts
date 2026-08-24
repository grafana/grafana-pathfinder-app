/**
 * The notifier exists so no enroller reaches for telemetry directly. Its value is
 * entirely in that absence, which the last case here is what actually pins:
 * `lib/telemetry/session` statically imports the Faro adapter, so an import of it
 * from an experiment module downloads the telemetry chunk on every stack — including
 * the ones where `pathfinder.frontend-telemetry` is off and Faro never initialises.
 */

import * as fs from 'fs';
import * as path from 'path';

describe('enrollment notifier', () => {
  it('is a no-op with nothing subscribed', () => {
    jest.isolateModules(() => {
      const { notifyEnrollment } = require('./enrollment-notifier');

      expect(() => notifyEnrollment()).not.toThrow();
    });
  });

  it('calls every subscriber on every notification, and stops after unsubscribe', () => {
    jest.isolateModules(() => {
      const { subscribeToEnrollment, notifyEnrollment } = require('./enrollment-notifier');
      const stamper = jest.fn();
      const banner = jest.fn();

      subscribeToEnrollment(stamper);
      const unsubscribe = subscribeToEnrollment(banner);
      notifyEnrollment();
      unsubscribe();
      notifyEnrollment();

      expect(stamper).toHaveBeenCalledTimes(2);
      expect(banner).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps notifying the rest when one subscriber throws', () => {
    jest.isolateModules(() => {
      const { subscribeToEnrollment, notifyEnrollment } = require('./enrollment-notifier');
      const survivor = jest.fn();

      subscribeToEnrollment(() => {
        throw new Error('telemetry exploded');
      });
      subscribeToEnrollment(survivor);

      expect(() => notifyEnrollment()).not.toThrow();
      expect(survivor).toHaveBeenCalledTimes(1);
    });
  });

  it('survives a subscriber that unsubscribes during the notification', () => {
    jest.isolateModules(() => {
      const { subscribeToEnrollment, notifyEnrollment } = require('./enrollment-notifier');
      const later = jest.fn();

      const unsubscribe = subscribeToEnrollment(() => unsubscribe());
      subscribeToEnrollment(later);

      notifyEnrollment();

      expect(later).toHaveBeenCalledTimes(1);
    });
  });

  it('imports nothing, so no experiment module can cycle through it', () => {
    const source = fs.readFileSync(path.join(__dirname, 'enrollment-notifier.ts'), 'utf8');

    expect(source).not.toMatch(/^\s*(import|export)\s.*\sfrom\s/m);
  });

  it('keeps telemetry out of the experiment modules that notify it', () => {
    const offenders = fs
      .readdirSync(__dirname)
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
      // Matches both import forms. The dynamic one is the case that matters: it looks
      // like it defers the cost, but the chunk still ships and still gets fetched.
      .filter((name) =>
        /(?:\bfrom\b|\bimport\b)\s*\(?\s*'[^']*lib\/(?:telemetry|faro)/.test(
          fs.readFileSync(path.join(__dirname, name), 'utf8')
        )
      );

    if (offenders.length > 0) {
      throw new Error(
        `These experiment modules import telemetry directly:\n` +
          offenders.map((name) => `  - src/utils/experiments/${name}`).join('\n') +
          `\n\nlib/telemetry/session statically pulls in the Faro adapter, so importing it ` +
          `here — dynamically included — loads the telemetry chunk even when ` +
          `pathfinder.frontend-telemetry is off. Call notifyEnrollment() instead and let ` +
          `module.tsx bind the sink from inside its telemetry block.`
      );
    }
  });
});
