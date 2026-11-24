import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-sidecar-'));
}

function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf-8');
}

/** A content-only package with one block, plus the given `i18n/` files (raw text, written as given). */
export function writePackage(root: string, name: string, sidecars: Record<string, string> = {}): string {
  const dir = path.join(root, name);
  writeFile(
    path.join(dir, 'content.json'),
    JSON.stringify({ id: name, title: 'Guide', blocks: [{ type: 'markdown', id: 'intro', content: 'Hello' }] })
  );
  for (const [tag, raw] of Object.entries(sidecars)) {
    writeFile(path.join(dir, 'i18n', `${tag}.json`), raw);
  }
  return dir;
}

export function sidecarJson(tag: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ schemaVersion: '1.0.0', language: tag, ...extra });
}
