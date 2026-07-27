import { of, throwError } from 'rxjs';
import { fetchBackendInteractive } from './backend-guide';

let mockNamespace: string | undefined = 'stacks-123';
const mockFetch = jest.fn();
const mockValidateGuide = jest.fn();

jest.mock('@grafana/runtime', () => ({
  config: {
    get namespace() {
      return mockNamespace;
    },
  },
  getBackendSrv: () => ({ fetch: mockFetch }),
}));

jest.mock('../../validation', () => ({
  validateGuide: (guide: unknown) => mockValidateGuide(guide),
}));

const okResource = (overrides: Record<string, unknown> = {}) => ({
  data: {
    metadata: { name: 'resource-name' },
    spec: { id: 'guide-id', title: 'My Guide', schemaVersion: '1.0', blocks: [{ type: 'markdown', content: 'hi' }] },
    ...overrides,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockNamespace = 'stacks-123';
  mockValidateGuide.mockReturnValue({ isValid: true, errors: [] });
});

describe('fetchBackendInteractive — guard clauses', () => {
  it('rejects an empty resource name without hitting the backend', async () => {
    const result = await fetchBackendInteractive('backend-guide:');

    expect(result.content).toBeNull();
    expect(result.error).toBe('Invalid backend guide resource name');
    expect(result.errorType).toBe('other');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects when no namespace is available', async () => {
    mockNamespace = undefined;

    const result = await fetchBackendInteractive('backend-guide:my-guide');

    expect(result.content).toBeNull();
    expect(result.error).toBe('No namespace available to load custom guide');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('fetchBackendInteractive — missing required fields', () => {
  it('errors when the resource has no blocks', async () => {
    mockFetch.mockReturnValue(of({ data: { spec: { title: 'No Blocks' } } }));

    const result = await fetchBackendInteractive('backend-guide:my-guide');

    expect(result.content).toBeNull();
    expect(result.error).toContain('missing required fields');
    expect(mockValidateGuide).not.toHaveBeenCalled();
  });

  it('errors when the resource has no title', async () => {
    mockFetch.mockReturnValue(of({ data: { spec: { blocks: [{ type: 'markdown', content: 'x' }] } } }));

    const result = await fetchBackendInteractive('backend-guide:my-guide');

    expect(result.content).toBeNull();
    expect(result.error).toContain('missing required fields');
  });
});

describe('fetchBackendInteractive — schema validation', () => {
  it('errors when the assembled guide fails schema validation', async () => {
    mockFetch.mockReturnValue(of(okResource()));
    mockValidateGuide.mockReturnValue({ isValid: false, errors: [{ message: 'bad block at index 0' }] });

    const result = await fetchBackendInteractive('backend-guide:my-guide');

    expect(result.content).toBeNull();
    expect(result.error).toBe('Invalid custom guide: bad block at index 0');
  });

  it('uses a generic message when validation reports no error detail', async () => {
    mockFetch.mockReturnValue(of(okResource()));
    mockValidateGuide.mockReturnValue({ isValid: false, errors: [] });

    const result = await fetchBackendInteractive('backend-guide:my-guide');

    expect(result.error).toBe('Invalid custom guide: Schema validation failed');
  });
});

describe('fetchBackendInteractive — happy path', () => {
  it('returns an interactive guide built from the resource spec', async () => {
    mockFetch.mockReturnValue(of(okResource()));

    const result = await fetchBackendInteractive('backend-guide:my-guide');

    expect(result.content).not.toBeNull();
    expect(result.content!.type).toBe('interactive');
    expect(result.content!.metadata.title).toBe('My Guide');
    const guide = JSON.parse(result.content!.content);
    expect(guide).toEqual({
      id: 'guide-id',
      title: 'My Guide',
      schemaVersion: '1.0',
      blocks: [{ type: 'markdown', content: 'hi' }],
    });
  });

  it('falls back to the resource name for the id when spec.id and metadata.name are absent', async () => {
    mockFetch.mockReturnValue(of({ data: { spec: { title: 'T', blocks: [{ type: 'markdown', content: 'x' }] } } }));

    const result = await fetchBackendInteractive('backend-guide:my-guide');

    expect(JSON.parse(result.content!.content).id).toBe('my-guide');
  });

  it('defaults schemaVersion to 1.0 when the spec omits it', async () => {
    mockFetch.mockReturnValue(of({ data: { spec: { title: 'T', blocks: [{ type: 'markdown', content: 'x' }] } } }));

    const result = await fetchBackendInteractive('backend-guide:my-guide');

    expect(JSON.parse(result.content!.content).schemaVersion).toBe('1.0');
  });
});

describe('fetchBackendInteractive — path traversal guard (F3)', () => {
  it('percent-encodes the resource name into the endpoint path', async () => {
    mockFetch.mockReturnValue(of(okResource()));

    await fetchBackendInteractive('backend-guide:../../etc/passwd');

    const calledUrl = mockFetch.mock.calls[0]![0].url as string;
    expect(calledUrl).toContain('/interactiveguides/');
    // The traversal sequence is encoded, so no raw path separators leak into the segment.
    expect(calledUrl).toContain(encodeURIComponent('../../etc/passwd'));
    expect(calledUrl).not.toContain('/interactiveguides/../../');
  });

  it('scopes the request to the current namespace', async () => {
    mockFetch.mockReturnValue(of(okResource()));

    await fetchBackendInteractive('backend-guide:my-guide');

    const calledUrl = mockFetch.mock.calls[0]![0].url as string;
    expect(calledUrl).toContain('/namespaces/stacks-123/');
  });
});

describe('fetchBackendInteractive — transport failure', () => {
  it('maps a thrown request to a load error and surfaces the status code', async () => {
    mockFetch.mockReturnValue(throwError(() => ({ status: 503 })));

    const result = await fetchBackendInteractive('backend-guide:my-guide');

    expect(result.content).toBeNull();
    expect(result.error).toBe('Failed to load custom guide: my-guide');
    expect(result.errorType).toBe('other');
    expect(result.statusCode).toBe(503);
  });
});
