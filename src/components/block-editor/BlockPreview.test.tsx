import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import { parseJsonGuide } from '../../docs-retrieval';
import { BlockPreview } from './BlockPreview';
import type { JsonGuide } from './types';

jest.mock('../content-renderer/content-renderer', () => ({
  ContentRenderer: () => <div data-testid="preview-content-renderer" />,
}));

jest.mock('./hooks/useGuidePreviewProgress', () => ({
  useGuidePreviewProgress: () => ({ hasProgress: false, reset: jest.fn() }),
}));

const inlineSnippetRefsInGuideMock = jest.fn();
jest.mock('../../snippet-engine', () => {
  const actual = jest.requireActual('../../snippet-engine');
  return {
    ...actual,
    inlineSnippetRefsInGuide: (...args: unknown[]) => inlineSnippetRefsInGuideMock(...args),
  };
});

const snippetGuide: JsonGuide = {
  id: 'preview-guide',
  title: 'New guide',
  blocks: [{ type: 'snippet-ref', snippetId: 'datasource-picker' }],
};

const resolvedGuide: JsonGuide = {
  id: 'preview-guide',
  title: 'New guide',
  blocks: [{ type: 'markdown', content: 'Select the datasource.' }],
};

describe('BlockPreview snippet handling', () => {
  beforeEach(() => {
    inlineSnippetRefsInGuideMock.mockReset();
    inlineSnippetRefsInGuideMock.mockResolvedValue(resolvedGuide);
  });

  it('does not surface a false unresolved-snippet warning for a valid ref', async () => {
    // Validating the raw guide (no inlining) would emit the warning — the
    // preview must resolve refs first so the author never sees it.
    const raw = parseJsonGuide(snippetGuide);
    expect((raw.warnings || []).some((w) => w.includes('Unresolved snippet reference'))).toBe(true);

    render(<BlockPreview guide={snippetGuide} />);

    await waitFor(() => expect(inlineSnippetRefsInGuideMock).toHaveBeenCalled());

    expect(screen.queryByText(/Unresolved snippet reference/)).not.toBeInTheDocument();
    expect(screen.getByTestId('preview-content-renderer')).toBeInTheDocument();
  });

  it('skips the inlining pass when the guide references no snippets', () => {
    render(<BlockPreview guide={resolvedGuide} />);
    expect(inlineSnippetRefsInGuideMock).not.toHaveBeenCalled();
  });
});
