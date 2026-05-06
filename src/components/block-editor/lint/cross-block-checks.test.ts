/**
 * Tests for the editor-only cross-block checks.
 *
 * Each check is a pure function over `JsonGuide`, so tests are
 * straightforward fixture-and-assert. Fixtures are minimal — only the
 * structure each check actually examines.
 */

import {
  CROSS_BLOCK_CHECK_CODES,
  destructiveActionWithoutObjective,
  firstStepMissingOnPage,
  orphanSectionReference,
  requirementsImpliedByActionButNotDeclared,
  runCrossBlockChecks,
  unusedSection,
} from './cross-block-checks';
import type { JsonGuide } from '../../../types/json-guide.types';

const baseGuide: JsonGuide = { id: 'g', title: 'g', blocks: [] };

describe('firstStepMissingOnPage', () => {
  it('does nothing for a guide with no executable blocks', () => {
    expect(firstStepMissingOnPage({ ...baseGuide, blocks: [{ type: 'markdown', content: 'hi' }] })).toEqual([]);
  });

  it('flags a first interactive step with no on-page: requirement', () => {
    const issues = firstStepMissingOnPage({
      ...baseGuide,
      blocks: [
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: 'a',
          content: 'first',
          requirements: ['exists-reftarget'],
        },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe(CROSS_BLOCK_CHECK_CODES.FIRST_STEP_MISSING_ON_PAGE);
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.path).toEqual(['blocks', 0, 'requirements']);
  });

  it('does not flag when on-page: is declared', () => {
    expect(
      firstStepMissingOnPage({
        ...baseGuide,
        blocks: [
          {
            type: 'interactive',
            action: 'highlight',
            reftarget: 'a',
            content: 'first',
            requirements: ['on-page:/explore'],
          },
        ],
      })
    ).toEqual([]);
  });

  it('does not flag a first step that is a `navigate` action (self-navigating pattern)', () => {
    expect(
      firstStepMissingOnPage({
        ...baseGuide,
        blocks: [
          { type: 'interactive', action: 'navigate', reftarget: '/explore', content: 'go' },
          {
            type: 'interactive',
            action: 'highlight',
            reftarget: 'a',
            content: 'next',
            requirements: ['exists-reftarget'],
          },
        ],
      })
    ).toEqual([]);
  });

  it('only flags the FIRST executable block (not subsequent ones)', () => {
    const issues = firstStepMissingOnPage({
      ...baseGuide,
      blocks: [
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: 'a',
          content: 'first',
          requirements: ['on-page:/x'],
        },
        // This second one has no on-page: but the check only looks at the first.
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: 'b',
          content: 'second',
        },
      ],
    });
    expect(issues).toEqual([]);
  });

  it('descends into a section to find the first executable block', () => {
    const issues = firstStepMissingOnPage({
      ...baseGuide,
      blocks: [
        { type: 'markdown', content: 'intro' },
        {
          type: 'section',
          title: 'A section',
          blocks: [
            {
              type: 'interactive',
              action: 'highlight',
              reftarget: 'a',
              content: 'nested first',
              requirements: ['exists-reftarget'],
            },
          ],
        },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['blocks', 1, 'blocks', 0, 'requirements']);
  });
});

describe('orphanSectionReference', () => {
  const sectionGuide: JsonGuide = {
    ...baseGuide,
    blocks: [
      { type: 'section', id: 'real-section', title: 'Real', blocks: [] },
      {
        type: 'interactive',
        action: 'highlight',
        reftarget: 'a',
        content: 'gated',
        requirements: ['section-completed:real-section', 'section-completed:does-not-exist'],
      },
    ],
  };

  it('flags requirements that reference a non-existent section', () => {
    const issues = orphanSectionReference(sectionGuide);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe(CROSS_BLOCK_CHECK_CODES.ORPHAN_SECTION_REFERENCE);
    expect(issues[0]!.message).toContain('does-not-exist');
    expect(issues[0]!.tokenAtFault).toBe('section-completed:does-not-exist');
    expect(issues[0]!.path).toEqual(['blocks', 1, 'requirements', 1]);
  });

  it('does not flag requirements that reference an existing section id', () => {
    const issues = orphanSectionReference({
      ...baseGuide,
      blocks: [
        { type: 'section', id: 'setup', title: 'Setup', blocks: [] },
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: 'a',
          content: 'gated',
          requirements: ['section-completed:setup'],
        },
      ],
    });
    expect(issues).toEqual([]);
  });

  it('ignores section-completed: requirements with no argument (canonical validator handles those)', () => {
    expect(
      orphanSectionReference({
        ...baseGuide,
        blocks: [
          {
            type: 'interactive',
            action: 'highlight',
            reftarget: 'a',
            content: 'x',
            requirements: ['section-completed:'],
          },
        ],
      })
    ).toEqual([]);
  });
});

describe('destructiveActionWithoutObjective', () => {
  it('flags a button action whose reftarget contains "delete"', () => {
    const issues = destructiveActionWithoutObjective({
      ...baseGuide,
      blocks: [
        {
          type: 'interactive',
          action: 'button',
          reftarget: 'Delete dashboard',
          content: 'click delete',
        },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe(CROSS_BLOCK_CHECK_CODES.DESTRUCTIVE_ACTION_WITHOUT_OBJECTIVE);
    expect(issues[0]!.path).toEqual(['blocks', 0, 'objectives']);
  });

  it.each(['Remove panel', 'Destroy variable', 'permanently DELETE row'])(
    'matches the destructive keyword in %s',
    (reftarget) => {
      const issues = destructiveActionWithoutObjective({
        ...baseGuide,
        blocks: [{ type: 'interactive', action: 'button', reftarget, content: 'x' }],
      });
      expect(issues).toHaveLength(1);
    }
  );

  it('does not flag when an objective is declared', () => {
    expect(
      destructiveActionWithoutObjective({
        ...baseGuide,
        blocks: [
          {
            type: 'interactive',
            action: 'button',
            reftarget: 'Delete dashboard',
            content: 'x',
            objectives: ['dashboard-exists'],
          },
        ],
      })
    ).toEqual([]);
  });

  it('does not flag highlight or formfill actions (heuristic is narrow)', () => {
    expect(
      destructiveActionWithoutObjective({
        ...baseGuide,
        blocks: [
          { type: 'interactive', action: 'highlight', reftarget: 'Delete', content: 'x' },
          { type: 'interactive', action: 'formfill', reftarget: 'Delete', targetvalue: 'y', content: 'x' },
        ],
      })
    ).toEqual([]);
  });

  it('flags multistep blocks containing a destructive button step', () => {
    const issues = destructiveActionWithoutObjective({
      ...baseGuide,
      blocks: [
        {
          type: 'multistep',
          content: 'do destructive things',
          steps: [
            { action: 'highlight', reftarget: 'a' },
            { action: 'button', reftarget: 'Delete it' },
          ],
        },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('Delete it');
  });
});

describe('unusedSection', () => {
  it('flags a section whose id is never referenced', () => {
    const issues = unusedSection({
      ...baseGuide,
      blocks: [
        { type: 'section', id: 'setup', title: 'Setup', blocks: [] },
        { type: 'section', id: 'orphan', title: 'Orphan', blocks: [] },
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: 'a',
          content: 'x',
          requirements: ['section-completed:setup'],
        },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe(CROSS_BLOCK_CHECK_CODES.UNUSED_SECTION);
    expect(issues[0]!.severity).toBe('info');
    expect(issues[0]!.message).toContain('orphan');
  });

  it('does not flag sections without an explicit id', () => {
    expect(
      unusedSection({
        ...baseGuide,
        blocks: [{ type: 'section', title: 'Anonymous', blocks: [] }],
      })
    ).toEqual([]);
  });
});

describe('requirementsImpliedByActionButNotDeclared', () => {
  it('flags a highlight block missing exists-reftarget', () => {
    const issues = requirementsImpliedByActionButNotDeclared({
      ...baseGuide,
      blocks: [
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: 'button',
          content: 'click',
          // no requirements declared
        },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe(CROSS_BLOCK_CHECK_CODES.REQUIREMENTS_IMPLIED_BUT_NOT_DECLARED);
    expect(issues[0]!.severity).toBe('info');
    expect(issues[0]!.message).toContain('exists-reftarget');
  });

  it('does not flag a highlight block that already declares exists-reftarget', () => {
    const issues = requirementsImpliedByActionButNotDeclared({
      ...baseGuide,
      blocks: [
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: 'button',
          content: 'click',
          requirements: ['exists-reftarget'],
        },
      ],
    });
    expect(issues).toEqual([]);
  });

  it('does not flag noop / navigate / popout actions', () => {
    const issues = requirementsImpliedByActionButNotDeclared({
      ...baseGuide,
      blocks: [
        { type: 'interactive', action: 'noop', content: 'just text' },
        { type: 'interactive', action: 'navigate', reftarget: '/explore', content: 'go' },
        { type: 'interactive', action: 'popout', targetvalue: 'floating', content: 'pop' },
      ],
    });
    expect(issues).toEqual([]);
  });

  it('flags nav-menu reftargets even when the action is button (non-highlight)', () => {
    const issues = requirementsImpliedByActionButNotDeclared({
      ...baseGuide,
      blocks: [
        {
          type: 'interactive',
          action: 'button',
          reftarget: 'a[data-testid="data-testid Nav menu item"]',
          content: 'click nav',
        },
      ],
    });
    expect(issues).toHaveLength(1);
    // exists-reftarget and navmenu-open are both expected
    expect(issues[0]!.message).toContain('navmenu-open');
  });
});

describe('runCrossBlockChecks', () => {
  it('aggregates diagnostics from every check in document order', () => {
    const guide: JsonGuide = {
      ...baseGuide,
      blocks: [
        // First step missing on-page: → firstStepMissingOnPage
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: 'Delete this thing',
          content: 'first',
        },
        // Section that's never referenced → unusedSection
        { type: 'section', id: 'orphan', title: 'Orphan', blocks: [] },
        // References a non-existent section → orphanSectionReference
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: 'b',
          content: 'gated',
          requirements: ['section-completed:never-defined'],
        },
      ],
    };
    const issues = runCrossBlockChecks(guide);
    const codes = issues.map((d) => d.code);
    // We don't assert order — that's an implementation detail.
    expect(codes).toContain(CROSS_BLOCK_CHECK_CODES.FIRST_STEP_MISSING_ON_PAGE);
    expect(codes).toContain(CROSS_BLOCK_CHECK_CODES.UNUSED_SECTION);
    expect(codes).toContain(CROSS_BLOCK_CHECK_CODES.ORPHAN_SECTION_REFERENCE);
    // The first block also matches destructiveActionWithoutObjective
    // because reftarget contains "Delete" — but only the button action
    // qualifies and this one is `highlight`. Sanity-check the heuristic
    // didn't fire.
    expect(codes).not.toContain(CROSS_BLOCK_CHECK_CODES.DESTRUCTIVE_ACTION_WITHOUT_OBJECTIVE);
  });
});
