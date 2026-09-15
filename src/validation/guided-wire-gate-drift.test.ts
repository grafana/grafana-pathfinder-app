import * as fs from 'fs';
import * as path from 'path';

import { GUIDED_ACTION_TYPES } from '../types/interactive-actions.types';

const EXECUTOR_PATH = path.resolve(__dirname, '..', 'integrations', 'cross-tab', 'live-tab-executor.ts');

// `GUIDED_VERBS` in live-tab-executor.ts gates what one tab will replay on
// behalf of another. It is deliberately NOT derived from GUIDED_ACTION_TYPES:
// per the decision recorded on #1525, deriving a cross-tab receive gate from an
// action union couples a wire contract to a local refactor, and a gate widened
// by accident starts accepting messages the executor has no handler for. Its
// input is untrusted cross-tab data, so the runtime check stays regardless of
// how well-typed the sender is.
//
// Keeping it literal means it can silently fall out of step with the verbs the
// guided handler actually drives. This test makes that loud without creating the
// coupling: the two lists must agree, and changing either one deliberately means
// changing both in the same commit.
describe('cross-tab guided receive gate', () => {
  it('lists exactly the verbs a guided block may author', () => {
    const source = fs.readFileSync(EXECUTOR_PATH, 'utf8');
    const match = source.match(/const GUIDED_VERBS[^=]*=\s*new Set\(\[([^\]]*)\]\)/);

    expect(match).not.toBeNull();

    const literals = [...match![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);

    expect([...literals].sort()).toEqual([...GUIDED_ACTION_TYPES].sort());
  });
});
