/**
 * section-registry-third-deriver-double-count: content-renderer.tsx's
 * documentLayout memo pre-registers each section under a PREDICTED id so
 * the step registry knows every section's step count before children
 * render. InteractiveSection then re-registers under its OWN derived id.
 * The two must agree — a full render with a section that has no author
 * `id` used to predict `section-<counter>` while InteractiveSection
 * registered under the parser-stamped `section:<path>`, so both entries
 * survived in the registry and getTotalDocumentSteps() double-counted it.
 *
 * A genuine full React render, not a registry unit test — the defect is in
 * whether two independent derivations agree, which only shows up when both
 * actually run.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';

import type { RawContent } from '../../types/content.types';
import { getTotalDocumentSteps } from '../../global-state/section-registry';
import { ContentRenderer } from './content-renderer';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

function interactiveStep(reftarget: string) {
  return {
    type: 'interactive',
    action: 'highlight',
    reftarget,
    content: 'Step content',
  };
}

function jsonGuide(sections: Array<{ id?: string; steps: number }>): string {
  return JSON.stringify({
    id: 'section-registry-guide',
    title: 'Section registry guide',
    blocks: sections.map((section, sectionIndex) => ({
      type: 'section',
      ...(section.id ? { id: section.id } : {}),
      title: `Section ${sectionIndex + 1}`,
      blocks: Array.from({ length: section.steps }, (_, i) =>
        interactiveStep(`a[href='/target-${sectionIndex}-${i}']`)
      ),
    })),
  });
}

function makeContent(html: string, url: string): RawContent {
  return {
    content: html,
    type: 'learning-journey',
    url,
    lastFetched: '2026-07-31T00:00:00.000Z',
    metadata: { title: 'Demo' },
  };
}

describe('ContentRenderer — section registry stays single-entry per section', () => {
  it('does not double-count an id-less section (section-registry-third-deriver-double-count)', async () => {
    // Section 1 has an author id (2 steps); section 2 has none (3 steps).
    // Truth: 5. The bug reported 7 — the id-less section's steps counted twice.
    const html = jsonGuide([{ id: 'with-author-id', steps: 2 }, { steps: 3 }]);

    render(<ContentRenderer content={makeContent(html, 'https://ex/section-registry-guide')} />);

    await waitFor(() => expect(getTotalDocumentSteps()).toBeGreaterThan(0));
    expect(getTotalDocumentSteps()).toBe(5);
  });

  it('does not double-count when EVERY section is id-less', async () => {
    // Truth: 2 + 4 = 6. Two id-less sections in one document, so a
    // per-section counter drift would compound rather than cancel out.
    const html = jsonGuide([{ steps: 2 }, { steps: 4 }]);

    render(<ContentRenderer content={makeContent(html, 'https://ex/all-idless-guide')} />);

    await waitFor(() => expect(getTotalDocumentSteps()).toBeGreaterThan(0));
    expect(getTotalDocumentSteps()).toBe(6);
  });
});
