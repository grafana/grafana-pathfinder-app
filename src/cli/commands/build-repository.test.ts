import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildRepository } from './build-repository';

describe('buildRepository prerequisites', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-repository-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('serializes prerequisite declarations in repository entries in source order', () => {
    const packageDir = path.join(root, 'guide');
    fs.mkdirSync(packageDir);
    fs.writeFileSync(
      path.join(packageDir, 'content.json'),
      JSON.stringify({ id: 'guide', title: 'Guide', blocks: [] })
    );
    const prerequisites = [
      { id: 'first', label: 'Literal **text**' },
      { id: 'second', label: '<strong>text</strong>' },
    ];
    fs.writeFileSync(
      path.join(packageDir, 'manifest.json'),
      JSON.stringify({ id: 'guide', type: 'guide', prerequisites })
    );

    const result = buildRepository(root);

    expect(result.errors).toEqual([]);
    expect(result.repository.guide?.prerequisites).toEqual(prerequisites);
    expect(JSON.parse(JSON.stringify(result.repository)).guide.prerequisites).toEqual(prerequisites);
  });

  it.each([undefined, []])('omits missing or empty prerequisites from the catalog: %s', (prerequisites) => {
    const packageDir = path.join(root, 'guide');
    fs.mkdirSync(packageDir);
    fs.writeFileSync(
      path.join(packageDir, 'content.json'),
      JSON.stringify({ id: 'guide', title: 'Guide', blocks: [] })
    );
    fs.writeFileSync(
      path.join(packageDir, 'manifest.json'),
      JSON.stringify({ id: 'guide', type: 'guide', prerequisites })
    );

    const result = buildRepository(root);

    expect(result.errors).toEqual([]);
    expect(result.repository.guide?.prerequisites).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result.repository)).guide).not.toHaveProperty('prerequisites');
  });
});
