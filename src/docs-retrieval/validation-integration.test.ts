import { fetchContent } from './content-fetcher';
import { buildBackendGuideContent } from './content-fetcher/backend-guide';
import { parseJsonGuide } from './json-parser';

// Mock validateGuide to control validation results if needed,
// but for integration tests we want to use the real one to verify it works.
// However, we might want to mock fetch for external URLs.

global.fetch = jest.fn();

// Mock security to allow our test URLs
jest.mock('../security', () => ({
  ...jest.requireActual('../security'),
  isAllowedContentUrl: jest.fn().mockReturnValue(true),
  isTrustedFinalUrl: jest.fn().mockReturnValue(true),
  isInteractiveLearningUrl: jest.fn().mockReturnValue(false),
  isGrafanaDocsUrl: jest.fn().mockReturnValue(false),
  isLocalhostUrl: jest.fn().mockReturnValue(false),
  isGitHubRawUrl: jest.fn().mockReturnValue(false),
}));

describe('Validation Integration Phase 1', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset fetch mock
    (global.fetch as jest.Mock).mockReset();
  });

  describe('bundled guides', () => {
    it('should successfully load and validate a known bundled guide', async () => {
      // 'welcome-to-grafana' is a standard bundled guide
      const result = await fetchContent('bundled:welcome-to-grafana');

      expect(result.error).toBeUndefined();
      expect(result.content).not.toBeNull();
      // Bundled guides are loaded as single-doc type with content string
      // The content string is valid JSON

      // Parse it to ensure it passes validation
      if (result.content?.content) {
        const parseResult = parseJsonGuide(result.content.content);
        expect(parseResult.isValid).toBe(true);
        expect(parseResult.errors).toHaveLength(0);
      }
    });
  });

  describe('json-parser validation', () => {
    it('should fail validation for guide missing required fields', () => {
      const invalidGuide = {
        id: 'test',
        // missing title
        blocks: [],
      };

      const result = parseJsonGuide(JSON.stringify(invalidGuide));
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('title'))).toBe(true);
      expect(result.errors[0]!.type).toBe('schema_validation');
    });

    it('should fail validation for guide with invalid blocks', () => {
      const invalidGuide = {
        id: 'test',
        title: 'Test',
        blocks: [
          { type: 'markdown' }, // missing content
        ],
      };

      const result = parseJsonGuide(JSON.stringify(invalidGuide));
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('content-fetcher validation', () => {
    it('should validate native JSON content from external URL', async () => {
      const validGuide = {
        id: 'test-guide',
        title: 'Test Guide',
        blocks: [{ type: 'markdown', content: 'Hello' }],
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://example.com/content.json',
        text: () => Promise.resolve(JSON.stringify(validGuide)),
        headers: { get: () => null },
      });

      const result = await fetchContent('https://example.com/content.json');
      expect(result.error).toBeUndefined();
      expect(result.content?.isNativeJson).toBe(true);
      expect(JSON.parse(result.content?.content || '{}')).toEqual(validGuide);
    });

    it('should fail when external JSON is invalid guide', async () => {
      const invalidGuide = {
        id: 'test-guide',
        // Missing title and blocks
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        url: 'https://example.com/content.json',
        text: () => Promise.resolve(JSON.stringify(invalidGuide)),
        headers: { get: () => null },
      });

      const result = await fetchContent('https://example.com/content.json');
      expect(result.content).toBeNull();
      expect(result.error).toContain('Invalid guide');
      expect(result.error).toContain('title'); // Should mention missing title
    });
  });
});

describe('already-published guide whose blocks[0] duplicates the title', () => {
  const duplicateHeadingGuide = {
    id: 'create-your-first-dashboard',
    title: 'Create your first dashboard',
    blocks: [
      { type: 'markdown', content: '# Create your first dashboard\n\nBuild your first dashboard.' },
      { type: 'markdown', content: 'Open the **Dashboards** page to begin.' },
    ],
  };

  it('still parses and renders through parseJsonGuide, reporting only a warning', () => {
    const result = parseJsonGuide(JSON.stringify(duplicateHeadingGuide));

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.data?.elements).toHaveLength(2);
    expect(result.warnings.some((w) => w.includes('duplicates the guide title'))).toBe(true);
  });

  it('still loads through fetchContent from an external URL', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      url: 'https://example.com/content.json',
      text: () => Promise.resolve(JSON.stringify(duplicateHeadingGuide)),
      headers: { get: () => null },
    });

    const result = await fetchContent('https://example.com/content.json');

    expect(result.error).toBeUndefined();
    expect(result.content).not.toBeNull();
    expect(JSON.parse(result.content?.content || '{}')).toEqual(duplicateHeadingGuide);
  });

  it('still loads through the App Platform custom-guide loader', () => {
    const result = buildBackendGuideContent(
      { metadata: { name: 'resource-name' }, spec: duplicateHeadingGuide },
      'backend-guide:resource-name',
      'resource-name'
    );

    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.content?.content || '{}').blocks).toHaveLength(2);
  });
});
