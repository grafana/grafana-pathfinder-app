import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { MyCompletionsResponseWireSchema } from '../types/backend-api.schema';
import { RecommendCompletionsWireSchema } from '../types/recommender-completions.schema';
import { projectRecommendCompletions } from './recommend-completions';

const TESTDATA = join(__dirname, 'testdata');
const INPUT_PATH = join(TESTDATA, 'my-completions.input.json');
const GOLDEN_PATH = join(TESTDATA, 'recommend-completions.v1.golden.json');

const DRIFT_MESSAGE =
  'This golden is the wire contract with grafana-recommender. If the change is intentional, rerun with ' +
  'UPDATE_GOLDENS=1, and open a follow-up on grafana-recommender to re-vendor it. A rename/removal/meaning ' +
  'change also bumps `v`.';

function projectInput() {
  const input = MyCompletionsResponseWireSchema.parse(JSON.parse(readFileSync(INPUT_PATH, 'utf8')));
  return RecommendCompletionsWireSchema.parse(projectRecommendCompletions(input));
}

describe('recommend completions golden', () => {
  it('matches the producer-owned wire contract', () => {
    const output = projectInput();

    if (process.env.UPDATE_GOLDENS === '1') {
      writeFileSync(GOLDEN_PATH, JSON.stringify(output, null, 2) + '\n');
      return;
    }

    const golden: unknown = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
    try {
      expect(output).toEqual(golden);
    } catch (error) {
      throw new Error(`${DRIFT_MESSAGE}\n\n${error instanceof Error ? error.message : String(error)}`);
    }
  });

  it('keeps the golden itself valid under the strict outbound schema', () => {
    const golden: unknown = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
    expect(RecommendCompletionsWireSchema.safeParse(golden).success).toBe(true);
  });
});
