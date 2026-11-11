import * as fs from 'fs';
import * as path from 'path';

import { parseAchievementDefinitions } from './achievements-client';

const golden = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../../../pkg/plugin/testdata/contract/achievements-definitions.default.json'),
    'utf8'
  )
);

describe('parseAchievementDefinitions', () => {
  it('reads the backend answer as it is', () => {
    expect(parseAchievementDefinitions(golden)?.sources).toEqual(golden.sources);
  });

  it('keeps the definitions when a backend from before sources answers', () => {
    const { sources: _omitted, ...older } = golden;
    const parsed = parseAchievementDefinitions(older);
    expect(parsed?.achievements).toEqual(golden.achievements);
    expect(parsed?.sources).toEqual([]);
  });

  it('drops keys a newer registry adds to a source or a condition instead of rejecting the answer', () => {
    const source = { ...golden.sources[0], emitter: 'grafana', when: [{ ...golden.sources[0].when[0], note: 'x' }] };
    const parsed = parseAchievementDefinitions({ ...golden, sources: [source] });
    expect(parsed?.sources).toEqual(golden.sources);
  });

  it('skips only a source it cannot read', () => {
    const parsed = parseAchievementDefinitions({
      ...golden,
      sources: [{ interaction: 'grafana_search_performed', properties: null }, golden.sources[0]],
    });
    expect(parsed?.sources).toEqual(golden.sources);
    expect(parsed?.achievements).toEqual(golden.achievements);
  });

  it('still refuses an answer whose definitions it cannot read', () => {
    expect(parseAchievementDefinitions({ ...golden, achievements: 'none' })).toBeNull();
  });
});
