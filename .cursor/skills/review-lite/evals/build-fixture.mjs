import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage: build-fixture.mjs --case ID --out DIR

Builds a Git repository for one synthetic case in evals/cases.json and prints its base and
per-round head SHAs as JSON. The printed output omits the case's expectations.

Example:
  node .cursor/skills/review-lite/evals/build-fixture.mjs --case consumer-break --out /abs/fixtures/consumer-break`;

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function commit(repo, files, message) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git(repo, 'add', '-A');
  git(repo, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

export function buildFixture(caseId, out) {
  const cases = JSON.parse(readFileSync(fileURLToPath(new URL('./cases.json', import.meta.url)), 'utf8'));
  const fixture = cases.synthetic.find(({ id }) => id === caseId);
  if (!fixture) {
    throw new Error(`Unknown case ${caseId}. Cases: ${cases.synthetic.map(({ id }) => id).join(', ')}`);
  }
  if (existsSync(out) && readdirSync(out).length > 0) {
    throw new Error(`${out} is not empty.`);
  }
  mkdirSync(out, { recursive: true });
  git(out, 'init', '-q', '-b', 'main');
  git(out, 'config', 'user.email', 'fixture@example.com');
  git(out, 'config', 'user.name', 'Fixture');
  const base = commit(out, fixture.base, 'Base');
  git(out, 'checkout', '-q', '-b', 'pr');
  const heads = fixture.rounds.map((round) => commit(out, round.files, round.message));
  git(out, 'checkout', '-q', 'main');
  return { case: fixture.id, request: fixture.request, repo: out, base, heads };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => args[args.indexOf(name) + 1];
  if (args.includes('--help') || !args.includes('--case') || !args.includes('--out') || !isAbsolute(flag('--out'))) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = args.includes('--help') ? 0 : 2;
  } else {
    try {
      process.stdout.write(`${JSON.stringify(buildFixture(flag('--case'), flag('--out')), null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
