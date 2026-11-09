import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const tutorials = JSON.parse(readFileSync(new URL('../src/constants/bundled-tutorials.json', import.meta.url)));

export async function checkBundledTutorialPublication(fetchResource = fetch) {
  const read = async (id, filename) => {
    const url = new URL(`${encodeURIComponent(id)}/${filename}`, 'https://interactive-learning.grafana.net/packages/');
    const response = await fetchResource(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      throw new Error(
        `${id}/${filename}: HTTP ${response.status}; publish interactive-tutorials #714 before releasing`
      );
    }
    const value = await response.json();
    if (value.id !== id) {
      throw new Error(`${id}/${filename}: mismatched package ID`);
    }
    return value;
  };
  for (const tutorial of tutorials) {
    await read(tutorial.id, 'manifest.json');
    if (tutorial.legacyOnlineId) {
      await read(tutorial.legacyOnlineId, 'manifest.json');
      await read(tutorial.legacyOnlineId, 'content.json');
      const content = await read(tutorial.id, 'content.json');
      const bundled = JSON.parse(
        readFileSync(new URL(`../src/bundled-interactives/${tutorial.id}/content.json`, import.meta.url))
      );
      if (content.title !== bundled.title) {
        throw new Error(
          `${tutorial.id}: published title differs from the migrated bundled tutorial; verify the RSS rename before releasing`
        );
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkBundledTutorialPublication();
  console.log('Bundled tutorial migration is published.');
}
