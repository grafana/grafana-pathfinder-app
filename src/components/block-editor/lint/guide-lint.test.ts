/**
 * Tests for guide-level lint.
 *
 * Focus: that the wrapper exposes the canonical `validateGuide` results in
 * the editor's `Diagnostic` shape, and that `forPath` correctly attributes
 * diagnostics to a JSON path prefix (used by the per-block badge).
 */

import { lintGuide } from './guide-lint';
import type { JsonGuide } from '../../../types/json-guide.types';

const baseGuide: JsonGuide = {
  id: 'test-guide',
  title: 'Test guide',
  blocks: [],
};

describe('lintGuide', () => {
  it('returns an empty result for null/undefined', () => {
    expect(lintGuide(null).diagnostics).toEqual([]);
    expect(lintGuide(undefined).diagnostics).toEqual([]);
    expect(lintGuide(null).isValid).toBe(true);
  });

  it('returns no diagnostics for a well-formed empty guide except the empty-blocks suggestion', () => {
    const result = lintGuide(baseGuide);
    // The canonical pipeline emits a "Guide has no blocks" suggestion, which
    // we surface as a warning.
    expect(result.isValid).toBe(true);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(0);
    // None of those diagnostics should have severity error.
    expect(result.diagnostics.find((d) => d.severity === 'error')).toBeUndefined();
  });

  it('flags an unknown requirement token as a Zod error', () => {
    // Unknown tokens (entirely unrecognized) are caught by the schema's
    // RequirementTokenSchema superRefine and surface as errors, not warnings.
    const guide: JsonGuide = {
      ...baseGuide,
      blocks: [
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: 'button',
          content: 'click',
          requirements: ['totally-bogus'],
        },
      ],
    };
    const result = lintGuide(guide);
    expect(result.isValid).toBe(false);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    // The error path must point inside the offending block's requirements.
    const error = errors.find((d) => d.path.includes('requirements'));
    expect(error).toBeDefined();
  });

  it('flags a format-level issue (on-page without leading slash) as a warning', () => {
    // `on-page:explore` passes the Zod schema (the prefix is known) but the
    // condition validator runs after Zod and flags the bad argument format
    // — that comes through as a warning, not an error.
    const guide: JsonGuide = {
      ...baseGuide,
      blocks: [
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: 'button',
          content: 'click',
          requirements: ['on-page:explore'],
        },
      ],
    };
    const result = lintGuide(guide);
    expect(result.isValid).toBe(true);
    const conditionDiag = result.diagnostics.find((d) => d.code === 'guide.invalid-condition');
    expect(conditionDiag).toBeDefined();
    expect(conditionDiag!.severity).toBe('warning');
  });

  it('strips path prefix and CLI hint from canonical messages', () => {
    const guide: JsonGuide = {
      ...baseGuide,
      blocks: [
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: 'button',
          content: 'click',
          requirements: ['is-amdin'],
        },
      ],
    };
    const result = lintGuide(guide);
    const issue = result.diagnostics.find((d) => d.path.includes('requirements'));
    expect(issue).toBeDefined();
    // Path prefix should not appear in the user-facing message.
    expect(issue!.message).not.toContain('blocks[0]');
    expect(issue!.message).not.toContain('requirements[0]:');
    // CLI hint should not appear either.
    expect(issue!.message).not.toContain('pathfinder-cli');
    // Suggestion should round-trip.
    expect(issue!.suggestion).toBe('is-admin');
    expect(issue!.tokenAtFault).toBe('is-amdin');
  });

  it('reports Zod errors at severity error and marks the result invalid', () => {
    // A formfill action requires a reftarget; missing it is a Zod error.
    const guide = {
      ...baseGuide,
      blocks: [
        {
          type: 'interactive',
          action: 'formfill',
          // reftarget intentionally omitted
          content: 'fill',
        },
      ],
    } as unknown as JsonGuide;
    const result = lintGuide(guide);
    expect(result.isValid).toBe(false);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('lintGuide forPath', () => {
  const guideWithMultipleBlocks: JsonGuide = {
    ...baseGuide,
    blocks: [
      {
        type: 'interactive',
        action: 'highlight',
        reftarget: 'button',
        content: 'first',
        // Clean block — no diagnostics expected here. `on-page:` keeps
        // the cross-block firstStepMissingOnPage check quiet.
        requirements: ['exists-reftarget', 'on-page:/explore'],
      },
      {
        type: 'interactive',
        action: 'highlight',
        reftarget: 'button',
        content: 'second',
        // Format issue — warning at ['blocks', 1, 'requirements', 0].
        requirements: ['on-page:explore'],
      },
      {
        type: 'section',
        title: 'A section',
        blocks: [
          {
            type: 'interactive',
            action: 'highlight',
            reftarget: 'button',
            content: 'nested',
            // Format issue — warning under ['blocks', 2, 'blocks', 0, ...].
            requirements: ['min-version:not-semver'],
          },
        ],
      },
    ],
  };

  it('returns no diagnostics for a clean block path', () => {
    const result = lintGuide(guideWithMultipleBlocks);
    expect(result.forPath(['blocks', 0])).toEqual([]);
  });

  it('returns the bad-token diagnostic for the offending block path', () => {
    const result = lintGuide(guideWithMultipleBlocks);
    const block1Diags = result.forPath(['blocks', 1]);
    expect(block1Diags.length).toBeGreaterThan(0);
    expect(block1Diags.every((d) => d.path[0] === 'blocks' && d.path[1] === 1)).toBe(true);
  });

  it('aggregates child-block diagnostics under the parent section path', () => {
    const result = lintGuide(guideWithMultipleBlocks);
    const sectionDiags = result.forPath(['blocks', 2]);
    expect(sectionDiags.length).toBeGreaterThan(0);
    // Every diagnostic must lie under the section's path.
    expect(sectionDiags.every((d) => d.path[0] === 'blocks' && d.path[1] === 2)).toBe(true);
  });

  it('returns ALL diagnostics when called with an empty prefix', () => {
    const result = lintGuide(guideWithMultipleBlocks);
    expect(result.forPath([])).toEqual(result.diagnostics);
  });
});

describe('lintGuide forPathDirect', () => {
  it('excludes diagnostics from nested-block children', () => {
    // Section at ['blocks', 0] with one bad child at ['blocks', 0, 'blocks', 0].
    const guide: JsonGuide = {
      ...baseGuide,
      blocks: [
        {
          type: 'section',
          title: 'A section',
          blocks: [
            {
              type: 'interactive',
              action: 'highlight',
              reftarget: 'button',
              content: 'nested',
              requirements: ['on-page:explore'], // format warning
            },
          ],
        },
      ],
    };
    const result = lintGuide(guide);
    // forPath aggregates children; forPathDirect must NOT.
    expect(result.forPath(['blocks', 0]).length).toBeGreaterThan(0);
    expect(result.forPathDirect(['blocks', 0])).toEqual([]);
    // The child path itself still surfaces its own diagnostics.
    expect(result.forPathDirect(['blocks', 0, 'blocks', 0]).length).toBeGreaterThan(0);
  });

  it('keeps step-level diagnostics on the parent multistep block', () => {
    // Steps are edited inline, so step diagnostics belong on the parent's badge.
    const guide: JsonGuide = {
      ...baseGuide,
      blocks: [
        {
          type: 'multistep',
          content: 'do these',
          steps: [
            {
              action: 'highlight',
              reftarget: 'button',
              requirements: ['on-page:explore'], // format warning at ['blocks', 0, 'steps', 0, ...]
            },
          ],
        },
      ],
    };
    const result = lintGuide(guide);
    expect(result.forPathDirect(['blocks', 0]).length).toBeGreaterThan(0);
  });

  it('returns nothing for an empty prefix', () => {
    const result = lintGuide(baseGuide);
    expect(result.forPathDirect([])).toEqual([]);
  });
});

describe('lintGuide metadata.lintIgnores', () => {
  it('suppresses editor-only diagnostics whose code is in lintIgnores', () => {
    // Guide with no on-page: on first step → fires firstStepMissingOnPage.
    const guide: JsonGuide = {
      ...baseGuide,
      blocks: [{ type: 'interactive', action: 'highlight', reftarget: 'a', content: 'x' }],
    };
    const before = lintGuide(guide);
    const beforeCodes = before.diagnostics.map((d) => d.code);
    expect(beforeCodes).toContain('editor.firstStepMissingOnPage');

    const after = lintGuide({
      ...guide,
      metadata: { lintIgnores: ['editor.firstStepMissingOnPage'] },
    });
    const afterCodes = after.diagnostics.map((d) => d.code);
    expect(afterCodes).not.toContain('editor.firstStepMissingOnPage');
  });

  it('does NOT suppress canonical Zod / condition diagnostics even if listed', () => {
    // Unknown requirement → Zod `zod.custom` error. Author trying to
    // ignore this code shouldn't succeed — it represents a real bug.
    const guide: JsonGuide = {
      ...baseGuide,
      blocks: [
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: 'a',
          content: 'x',
          requirements: ['totally-bogus'],
        },
      ],
      metadata: { lintIgnores: ['zod.custom'] },
    };
    const result = lintGuide(guide);
    const errorCodes = result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);
    expect(errorCodes).toContain('zod.custom');
  });
});
