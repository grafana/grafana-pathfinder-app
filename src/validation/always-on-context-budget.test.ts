/**
 * Always-on context budget.
 *
 * Every agent launched in this repo loads `AGENTS.md` (through `CLAUDE.md`) and
 * every skill's `description` before it reads anything else, so each byte here
 * is paid on every turn of every agent. This ratchet caps both.
 */

import * as fs from 'fs';
import * as path from 'path';
import { load } from 'js-yaml';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SKILL_SOURCE_DIR = '.cursor/skills';

const AGENTS_MD_MAX_BYTES = 8000;
const SKILL_DESCRIPTION_MAX_CHARS = 400;

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;

function skillDescription(skillMarkdown: string, label: string): string {
  const block = skillMarkdown.match(FRONTMATTER_RE)?.[1];
  if (block === undefined) {
    throw new Error(`${label} has no YAML frontmatter block.`);
  }
  const frontmatter = load(block);
  const description =
    frontmatter !== null && typeof frontmatter === 'object'
      ? (frontmatter as Record<string, unknown>).description
      : undefined;
  if (typeof description !== 'string') {
    throw new Error(`${label} frontmatter has no string description.`);
  }
  return description;
}

function skillNames(): string[] {
  return fs
    .readdirSync(path.join(REPO_ROOT, SKILL_SOURCE_DIR), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe('Always-on context budget', () => {
  it(`AGENTS.md stays within ${AGENTS_MD_MAX_BYTES} bytes`, () => {
    const bytes = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md')).byteLength;
    if (bytes > AGENTS_MD_MAX_BYTES) {
      throw new Error(
        [
          `AGENTS.md is ${bytes} bytes; the budget is ${AGENTS_MD_MAX_BYTES}.`,
          '',
          'AGENTS.md loads into every agent on every turn, so it holds only rules that apply to',
          'nearly every task. Move detail to where the agent that needs it will find it:',
          '  - a mechanical rule: the enforcing test failure message, which explains the fix',
          '  - a workflow: a skill under .cursor/skills/',
          '  - domain reference: a doc routed from docs/developer/CONTEXT_INDEX.md',
          'Then leave at most one line in AGENTS.md pointing at it. Raise the budget only when',
          'a rule genuinely applies to every agent and cannot live anywhere else.',
        ].join('\n')
      );
    }
  });

  it.each(skillNames())(`%s: skill description stays within ${SKILL_DESCRIPTION_MAX_CHARS} characters`, (name) => {
    const rel = `${SKILL_SOURCE_DIR}/${name}/SKILL.md`;
    const description = skillDescription(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8'), rel);
    if (description.length > SKILL_DESCRIPTION_MAX_CHARS) {
      throw new Error(
        [
          `${rel} description is ${description.length} characters; the budget is ${SKILL_DESCRIPTION_MAX_CHARS}.`,
          '',
          'Every agent sees every skill description, and a crowded skill listing drops descriptions',
          'entirely. Say what the skill does and when to use it; move trigger phrase lists and',
          'procedure into the skill body. Update the .claude/skills/ stub to match.',
        ].join('\n')
      );
    }
  });
});

describe('skillDescription', () => {
  it('reads a folded multi-line description as one string', () => {
    const markdown = '---\nname: demo\ndescription: First part\n  continues here.\n---\n\nBody';
    expect(skillDescription(markdown, 'demo')).toBe('First part continues here.');
  });

  it('reads a quoted description without its quotes', () => {
    const markdown = "---\nname: demo\ndescription: 'Quoted: with a colon'\n---\n";
    expect(skillDescription(markdown, 'demo')).toBe('Quoted: with a colon');
  });

  it('rejects a skill without frontmatter', () => {
    expect(() => skillDescription('# No frontmatter', 'demo')).toThrow('demo has no YAML frontmatter block.');
  });

  it('rejects frontmatter without a description', () => {
    expect(() => skillDescription('---\nname: demo\n---\n', 'demo')).toThrow(
      'demo frontmatter has no string description.'
    );
  });
});
