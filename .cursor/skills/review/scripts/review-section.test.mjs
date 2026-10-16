import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractSection, extractSections } from './review-section.mjs';

const SCRIPT = fileURLToPath(new URL('./concern-context.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const FIXTURE = [
  '# Title',
  '',
  '## Alpha',
  '',
  'Alpha body.',
  '',
  '### Alpha detail',
  '',
  'Nested body.',
  '',
  '```text',
  '## Not a heading',
  '```',
  '',
  '## Beta',
  '',
  'Beta body.',
  '',
].join('\n');

test('returns a section through its subsections and stops at the next sibling heading', () => {
  const section = extractSection(FIXTURE, 'Alpha');
  assert.match(section, /^## Alpha\n/);
  assert.match(section, /### Alpha detail/);
  assert.doesNotMatch(section, /Beta body/);
});

test('returns a subsection without its parent', () => {
  assert.equal(
    extractSection(FIXTURE, 'Alpha detail'),
    '### Alpha detail\n\nNested body.\n\n```text\n## Not a heading\n```'
  );
});

test('ignores heading-shaped lines inside fenced code blocks', () => {
  assert.throws(() => extractSection(FIXTURE, 'Not a heading'), /Section not found: "Not a heading"/);
});

test('names the known sections when a heading is missing', () => {
  assert.throws(() => extractSection(FIXTURE, 'Gamma'), /Known sections: "Alpha", "Alpha detail", "Beta"/);
});

test('rejects an ambiguous heading', () => {
  assert.throws(() => extractSection(`${FIXTURE}\n## Beta\n`, 'Beta'), /ambiguous: "Beta" appears 2 times/);
});

test('joins several sections in the requested order', () => {
  assert.equal(extractSections(FIXTURE, ['Beta', 'Alpha detail']).split('\n')[0], '## Beta');
  assert.throws(() => extractSections(FIXTURE, []), /at least one section heading/);
});

test('the CLI exits 2 with the reason on stderr for an unknown section', () => {
  assert.throws(
    () => execFileSync('node', [SCRIPT, '--section', 'No such section'], { stdio: 'pipe' }),
    (error) => error.status === 2 && /Section not found: "No such section"/.test(String(error.stderr))
  );
});

// Contract: every `concern-context.mjs --section` command the review skill tells agents to run
// resolves against the real PR_REVIEW.md, so a renamed heading fails here
// instead of leaving reviewers to fall back to reading the whole file.
test('every section command in the review skill runs against PR_REVIEW.md', () => {
  const skill = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8');
  const commandRe = /`node \.cursor\/skills\/review\/scripts\/concern-context\.mjs --section "([^"]+)"`/g;
  const headings = [...skill.matchAll(commandRe)].map((match) => match[1]);
  assert.ok(headings.length > 0, 'expected the review skill to cite concern-context.mjs --section commands');

  const whole = readFileSync(new URL('docs/design/PR_REVIEW.md', `file://${REPO_ROOT}`), 'utf8');
  for (const heading of headings) {
    const output = execFileSync('node', [SCRIPT, '--section', heading], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.match(output, new RegExp(`^#{2,6} ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
    assert.ok(output.length < whole.length, `"${heading}" returned the whole file`);
  }
});
