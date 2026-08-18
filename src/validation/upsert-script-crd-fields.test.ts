import * as fs from 'fs';
import * as path from 'path';

import { KNOWN_FIELDS } from '../types/json-guide.schema';

const SCRIPT_PATH = path.resolve(__dirname, '..', '..', 'scripts', 'upsert-learning-path.sh');

// scripts/upsert-learning-path.sh warns — and under --strict-blocks refuses —
// when content uses a block field the InteractiveGuide CRD does not declare,
// because the API server prunes it with a 200 and no message. The allowlist in
// the script is a hand transcription of `_blockFields` / `#Block` /
// `#NestedBlock` / `#Step` in grafana-pathfinder-backend's
// kinds/interactiveguide.cue, which lives in another repo and cannot be read
// from here.
//
// Both drift directions are silent and this test makes them loud:
//   - a field the app gains that the transcription lacks reads as a false
//     "the CRD will prune this" warning, and --strict-blocks rejects content
//     the CRD would have accepted;
//   - a field genuinely absent from the CRD has to be listed below, so it is
//     a deliberate entry rather than an oversight.
//
// Fields the app accepts that the CRD really does not declare. Verified
// against kinds/interactiveguide.cue; each one is silently dropped on upload.
//
// The `dataCheck*` family landed in #1612 and the backend CUE has not caught up
// yet, so an `input` block uploaded through the scripts loses its data check
// entirely — the picker renders, the check does not run. This entry is what made
// that visible; remove it when `#Block` declares them.
const PRUNED_BY_CRD = new Set([
  'defaultValue',
  'dataCheckQuery',
  'dataCheckBlocking',
  'dataCheckFailureMessage',
  'dataCheckTimeFrom',
  'dataCheckTimeTo',
]);

function scriptArray(name: string): Set<string> {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const match = source.match(new RegExp(`^def ${name}: \\[(.*?)\\];$`, 'm'));
  const entries = match?.[1];
  if (!entries) {
    throw new Error(`no "def ${name}:" array in ${SCRIPT_PATH}`);
  }
  return new Set(entries.split(',').map((entry) => entry.replace(/^"|"$/g, '')));
}

function appBlockFields(): Set<string> {
  const fields = new Set<string>();
  for (const [key, set] of Object.entries(KNOWN_FIELDS)) {
    // _guide, _choice and _manifest describe envelopes rather than blocks, and
    // _step is checked separately against the CRD's own #Step.
    if (key.startsWith('_')) {
      continue;
    }
    for (const field of set) {
      fields.add(field);
    }
  }
  return fields;
}

describe('upsert-learning-path.sh CRD field allowlist', () => {
  it('declares every block field the app schema uses, minus the documented prunes', () => {
    const declared = scriptArray('BLOCK');
    const missing = [...appBlockFields()].filter((field) => !declared.has(field) && !PRUNED_BY_CRD.has(field)).sort();

    expect(missing).toEqual([]);
  });

  it('declares every step field the app schema uses', () => {
    const declared = scriptArray('STEP');
    const stepFields = KNOWN_FIELDS._step ?? new Set<string>();
    const missing = [...stepFields].filter((field) => !declared.has(field)).sort();

    expect(stepFields.size).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it('does not list a field the app schema has dropped as still needed', () => {
    const stale = [...PRUNED_BY_CRD].filter((field) => !appBlockFields().has(field));

    expect(stale).toEqual([]);
  });
});
