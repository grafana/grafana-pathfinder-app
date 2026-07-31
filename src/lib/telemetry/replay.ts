import type { Faro, Metas } from '@grafana/faro-web-sdk';
import {
  ReplayInstrumentation,
  type MaskInputOptions,
  type ReplayInstrumentationOptions,
} from '@grafana/faro-instrumentation-replay';
import { testIds } from '../../constants/testIds';
import { scrubReplayEvent } from './replay-scrub';

// The SDK default is `{ password: true }` — every other input type falls back
// to maskAllInputs, which is easy to lose in a future refactor. Naming them all
// makes an unmasked input a deliberate act rather than an omission.
const MASK_EVERY_INPUT: MaskInputOptions = {
  color: true,
  date: true,
  'datetime-local': true,
  email: true,
  month: true,
  number: true,
  range: true,
  search: true,
  tel: true,
  text: true,
  time: true,
  url: true,
  week: true,
  textarea: true,
  select: true,
  password: true,
};

// The terminal is the one Pathfinder surface that renders credentials
// verbatim. It is already covered twice over — xterm draws to a WebGL canvas
// and recordCanvas is off — but it is worth one cheap attribute selector to
// stop that resting on two unrelated defaults. `isBlocked` runs matches() and
// closest() per mutated node, so nothing expensive belongs here (no `:has()`).
const BLOCK_SELECTOR = `[data-testid="${testIds.codaTerminal.panel}"]`;

const REPLAY_OPTIONS: ReplayInstrumentationOptions = {
  maskAllInputs: true,
  maskInputOptions: MASK_EVERY_INPUT,
  maskTextSelector: '*',
  blockSelector: BLOCK_SELECTOR,
  recordCanvas: false,
  inlineImages: false,
  inlineStylesheet: false,
  collectFonts: false,
  recordCrossOriginIframes: false,
  samplingRate: 1,
  beforeSend: scrubReplayEvent,
};

// faro-core's setSession() removes the session meta before adding its
// replacement, and both halves notify metas listeners — so every
// setFaroSessionAttributes call publishes one notification with no session at
// all. ReplayInstrumentation reads that as "not sampled", tears rrweb down,
// then restarts on the next notification, emitting a fresh full-DOM snapshot
// each time. Since Pathfinder stamps `surface` on every sidebar open and
// close, the recording fragmented into a clip per toggle. Hiding the
// session-less notification keeps one continuous recording. setView already
// adds-before-removing to avoid exactly this gap; drop this subclass once
// setSession does the same.
class ContinuousReplayInstrumentation extends ReplayInstrumentation {
  override initialize(): void {
    const metas = this.metas;
    const gapFree: Metas = {
      add: metas.add,
      remove: metas.remove,
      removeListener: metas.removeListener,
      addListener: (listener) =>
        metas.addListener((meta) => {
          if (meta.session?.id != null) {
            listener(meta);
          }
        }),
      get value() {
        return metas.value;
      },
    };
    this.metas = gapFree;
    try {
      super.initialize();
    } finally {
      this.metas = metas;
    }
  }
}

// Deliberately not part of the `instrumentations` array at init: recording
// would then start at page load, and passesActivityGate would drop the opening
// full-DOM snapshot, leaving a stream of mutations with nothing to apply them
// to. rrweb emits a fresh snapshot whenever record() starts, so registering
// late is what makes the replay playable at all.
export async function activateSessionReplay(faro: Faro): Promise<void> {
  faro.instrumentations.add(new ContinuousReplayInstrumentation(REPLAY_OPTIONS));
}
