/**
 * A fetch stand-in that serves the committed Grafana Learn `index.json`
 * fixtures from `src/docs-retrieval/__fixtures__/learn/`, plus any page body a
 * test registers. A fixture named `a.b.json` answers `https://grafana.com/docs/learning-hub/a/b/index.json`.
 * Anything unregistered answers 404, which is how a section's index fails.
 */

import * as fs from 'fs';
import * as path from 'path';

const FIXTURE_DIR = path.join(__dirname, '..', 'docs-retrieval', '__fixtures__', 'learn');
const LEARN_ROOT = 'https://grafana.com/docs/learning-hub';

export interface LearnFetchOptions {
  /** Index URLs, or fragments of them, that answer 500. */
  failing?: readonly string[];
  /** Page bodies by URL, for the page and its `unstyled.html`. A function answers any URL it returns a body for. */
  pages?: Record<string, string> | ((url: string) => string | undefined);
}

export function learnIndexUrl(...segments: string[]): string {
  return `${[LEARN_ROOT, ...segments].join('/')}/index.json`;
}

export function learnIndexFixtures(): Record<string, unknown> {
  const fixtures: Record<string, unknown> = {};
  for (const file of fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json'))) {
    const segments = file.replace(/\.json$/, '').split('.');
    fixtures[learnIndexUrl(...segments)] = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf-8'));
  }
  return fixtures;
}

function respond(url: string, status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    url,
    headers: new Headers(),
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

export function createLearnFetch({ failing = [], pages = {} }: LearnFetchOptions = {}): jest.Mock {
  const indexes = learnIndexFixtures();
  return jest.fn(async (input: string) => {
    const url = String(input);
    if (failing.some((fragment) => url.includes(fragment))) {
      return respond(url, 500, '');
    }
    if (url in indexes) {
      return respond(url, 200, JSON.stringify(indexes[url]));
    }
    const page = typeof pages === 'function' ? pages(url) : pages[url];
    if (page !== undefined) {
      return respond(url, 200, page);
    }
    return respond(url, 404, '');
  });
}
