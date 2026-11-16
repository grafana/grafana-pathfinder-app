import { fetchContent } from './content-fetcher';
import { fetchBackendInteractive } from './content-fetcher/backend-guide';

jest.mock('./content-fetcher/backend-guide', () => ({ fetchBackendInteractive: jest.fn() }));

const backendMock = jest.mocked(fetchBackendInteractive);

describe('backend-guide: URL carrying a PR-tester marker', () => {
  beforeEach(() => {
    backendMock.mockReset();
    backendMock.mockImplementation(async (url) => ({
      content: {
        content: '{}',
        metadata: { title: 'Custom' },
        type: 'interactive',
        url,
        lastFetched: new Date().toISOString(),
      },
    }));
  });

  it('looks the resource up without the marker and restores it on the result', async () => {
    const result = await fetchContent('backend-guide:my-guide#pf-pr-abc123');

    expect(backendMock).toHaveBeenCalledWith('backend-guide:my-guide', undefined);
    expect(result.content?.url).toBe('backend-guide:my-guide#pf-pr-abc123');
  });

  it('leaves an unmarked URL unmarked', async () => {
    const result = await fetchContent('backend-guide:my-guide');

    expect(result.content?.url).toBe('backend-guide:my-guide');
  });
});
