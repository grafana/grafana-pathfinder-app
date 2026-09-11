import { resolveGuideContentKey } from './guide-content-key';
import { resetContentKeyForTests, setActiveTabUrl } from './content-key';

const OPEN_TAB_URL = 'https://grafana.com/docs/learning-paths/demo/set-up/';

beforeEach(() => {
  resetContentKeyForTests();
  setActiveTabUrl(OPEN_TAB_URL);
});

afterEach(() => {
  resetContentKeyForTests();
});

describe('resolveGuideContentKey', () => {
  it('keys a block-editor preview off its own URL, not the panel open beside it', () => {
    expect(resolveGuideContentKey('block-editor://preview/demo')).toBe('block-editor://preview/demo');
  });

  it.each([
    ['a docs URL whose path contains "devtools"', 'https://grafana.com/docs/grafana/latest/devtools/setup/'],
    ['a journey content URL', 'https://grafana.com/docs/learning-paths/demo/set-up/content.json'],
    ['no URL at all', undefined],
  ])('defers to the progress system-wide key for %s', (_label, contentUrl) => {
    expect(resolveGuideContentKey(contentUrl)).toBe(OPEN_TAB_URL);
  });

  it('strips traversal dots from a preview URL it does key off', () => {
    expect(resolveGuideContentKey('block-editor://preview/../../etc')).not.toContain('..');
  });
});
