import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { loadGuideFiles } from '../file-loader';

describe('file-loader glob expansion', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-cli-'));
  const guidesRoot = path.join(tmpRoot, 'guides');

  beforeAll(() => {
    fs.mkdirSync(guidesRoot, { recursive: true });
    fs.mkdirSync(path.join(guidesRoot, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(guidesRoot, 'a.json'), '{"id":"a","title":"A","blocks": []}');
    fs.writeFileSync(path.join(guidesRoot, 'nested', 'b.json'), '{"id":"b","title":"B","blocks": []}');
    fs.writeFileSync(path.join(guidesRoot, 'nested', 'ignore.txt'), 'noop');
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('expands **/*.json patterns recursively', () => {
    const pattern = path.join(guidesRoot, '**/*.json');
    const guides = loadGuideFiles([pattern]);
    const files = guides.map((g) => path.basename(g.path));

    expect(files.sort()).toEqual(['a.json', 'b.json']);
    expect(guides).toHaveLength(2);
  });
});


