/**
 * HealthStatusBar tests.
 *
 * Drives the bar via a mocked `useGuideLintResult` hook so we can
 * control the diagnostics it sees independently of the real lint
 * pipeline. Covers severity-chip rendering, expand/collapse with
 * localStorage persistence, breadcrumb resolution for nested
 * diagnostics, and the deepest-first `Locate →` flash behaviour.
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { HealthStatusBar } from './HealthStatusBar';
import type { Diagnostic, GuideLintResult } from './lint';
import type { EditorBlock } from './types';

// Mock the lint hook so each test fully controls the diagnostics the
// bar sees.
const mockLint = jest.fn<GuideLintResult | null, []>();
jest.mock('./BlockEditorContext', () => ({
  useGuideLintResult: () => mockLint(),
}));

const STORAGE_KEY = 'pathfinder.blockEditor.healthPanel.open';

function makeLint(diagnostics: Diagnostic[]): GuideLintResult {
  return {
    diagnostics,
    forPath: () => diagnostics,
    forPathDirect: () => [],
    isValid: !diagnostics.some((d) => d.severity === 'error'),
  };
}

const SAMPLE_BLOCKS: EditorBlock[] = [
  {
    id: 'top-1',
    block: {
      type: 'section',
      id: 'setup',
      title: 'Setup',
      blocks: [
        { type: 'interactive', action: 'highlight', reftarget: 'a', content: 'hi' },
        { type: 'interactive', action: 'button', reftarget: 'btn', content: 'click' },
      ],
    },
  },
  { id: 'top-2', block: { type: 'markdown', content: 'hello' } },
];

beforeEach(() => {
  mockLint.mockReset();
  window.localStorage.removeItem(STORAGE_KEY);
});

describe('HealthStatusBar', () => {
  describe('severity chip rendering', () => {
    it('shows the "no issues" affordance when there are no diagnostics', () => {
      mockLint.mockReturnValue(makeLint([]));
      render(<HealthStatusBar blocks={SAMPLE_BLOCKS} />);
      expect(screen.getByText(/No issues/i)).toBeInTheDocument();
    });

    it('shows one chip per non-empty severity with the correct count', () => {
      const diagnostics: Diagnostic[] = [
        { severity: 'error', code: 'zod.x', message: 'broken', path: ['blocks', 0] },
        { severity: 'warning', code: 'editor.firstStepMissingOnPage', message: 'no on-page', path: ['blocks', 1] },
        { severity: 'warning', code: 'editor.orphanSectionReference', message: 'orphan', path: ['blocks', 0] },
        { severity: 'info', code: 'editor.unusedSection', message: 'unused', path: ['blocks', 0] },
      ];
      mockLint.mockReturnValue(makeLint(diagnostics));
      render(<HealthStatusBar blocks={SAMPLE_BLOCKS} />);

      // Each severity chip has an aria-label "{count} {label}".
      expect(screen.getByLabelText(/1 errors/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/2 warnings/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/1 suggestions/i)).toBeInTheDocument();
    });
  });

  describe('expand / collapse', () => {
    it('starts collapsed by default and expands on click', () => {
      mockLint.mockReturnValue(
        makeLint([{ severity: 'warning', code: 'editor.firstStepMissingOnPage', message: 'm', path: ['blocks', 0] }])
      );
      render(<HealthStatusBar blocks={SAMPLE_BLOCKS} />);

      const bar = screen.getByRole('button', { name: /Expand guide health/i });
      expect(bar).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(bar);
      const expanded = screen.getByRole('button', { name: /Collapse guide health/i });
      expect(expanded).toHaveAttribute('aria-expanded', 'true');
    });

    it('persists the expanded state to localStorage', () => {
      mockLint.mockReturnValue(makeLint([]));
      render(<HealthStatusBar blocks={SAMPLE_BLOCKS} />);
      fireEvent.click(screen.getByRole('button', { name: /Expand guide health/i }));
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');
    });

    it('starts expanded when localStorage already says so', () => {
      window.localStorage.setItem(STORAGE_KEY, 'true');
      mockLint.mockReturnValue(makeLint([]));
      render(<HealthStatusBar blocks={SAMPLE_BLOCKS} />);
      const bar = screen.getByRole('button', { name: /Collapse guide health/i });
      expect(bar).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('breadcrumb resolution for nested diagnostics', () => {
    beforeEach(() => {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    });

    it('renders the section title and the nested type label for a deep path', () => {
      const diagnostics: Diagnostic[] = [
        {
          severity: 'error',
          code: 'zod.custom',
          message: 'Unknown requirement',
          path: ['blocks', 0, 'blocks', 1, 'requirements', 0],
        },
      ];
      mockLint.mockReturnValue(makeLint(diagnostics));
      render(<HealthStatusBar blocks={SAMPLE_BLOCKS} />);

      // Breadcrumb shape: top-level Section "Setup" › nested Interactive 2.
      // Nested children of section render as "<Type> N", indices 1-based.
      expect(screen.getByText(/Section "Setup".*Interactive 2/)).toBeInTheDocument();
    });

    it('falls back to "<Type> <index+1>" when the top-level block has no title', () => {
      const diagnostics: Diagnostic[] = [{ severity: 'warning', code: 'editor.x', message: 'm', path: ['blocks', 1] }];
      mockLint.mockReturnValue(makeLint(diagnostics));
      render(<HealthStatusBar blocks={SAMPLE_BLOCKS} />);
      expect(screen.getByText(/Markdown 2/)).toBeInTheDocument();
    });
  });

  describe('Locate → flash', () => {
    let scrollSpy: jest.Mock;
    let animateSpy: jest.Mock;

    beforeEach(() => {
      window.localStorage.setItem(STORAGE_KEY, 'true');
      scrollSpy = jest.fn();
      animateSpy = jest.fn();
      // jsdom doesn't implement these — install no-op spies on the prototype.
      Element.prototype.scrollIntoView = scrollSpy as unknown as Element['scrollIntoView'];
      // animate isn't on Element, it lives on HTMLElement; cast to any.
      (HTMLElement.prototype as unknown as { animate: jest.Mock }).animate = animateSpy;
    });

    function makeHost(path: string): HTMLElement {
      const host = document.createElement('div');
      host.setAttribute('data-block-path', path);
      // Inner card target is what flashBlock animates; provide one.
      const card = document.createElement('div');
      card.setAttribute('data-block-card', '');
      host.appendChild(card);
      document.body.appendChild(host);
      return host;
    }

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('flashes the deepest matching `data-block-path` element', () => {
      makeHost('blocks.0');
      const inner = makeHost('blocks.0.blocks.1');

      mockLint.mockReturnValue(
        makeLint([
          {
            severity: 'error',
            code: 'zod.custom',
            message: 'broken',
            path: ['blocks', 0, 'blocks', 1, 'requirements', 0],
          },
        ])
      );
      render(<HealthStatusBar blocks={SAMPLE_BLOCKS} />);
      fireEvent.click(screen.getByRole('button', { name: /Locate/i }));

      // The inner card (descendant of the deepest match) gets the flash.
      const innerCard = inner.querySelector('[data-block-card]')!;
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(animateSpy).toHaveBeenCalledTimes(1);
      // `this` in animate.mock.instances is the receiver — confirm it's the
      // inner card, not the outer host or top-level block.
      expect(animateSpy.mock.instances[0]).toBe(innerCard);
    });

    it('falls back up the path when the deepest container has no DOM presence', () => {
      // Simulating a multistep step path: only the parent block is rendered.
      const parent = makeHost('blocks.0');
      // No element exists for `blocks.0.steps.1`.

      mockLint.mockReturnValue(
        makeLint([
          {
            severity: 'warning',
            code: 'editor.x',
            message: 'inside step',
            path: ['blocks', 0, 'steps', 1, 'requirements', 0],
          },
        ])
      );
      render(<HealthStatusBar blocks={SAMPLE_BLOCKS} />);
      fireEvent.click(screen.getByRole('button', { name: /Locate/i }));

      const parentCard = parent.querySelector('[data-block-card]')!;
      expect(animateSpy.mock.instances[0]).toBe(parentCard);
    });

    it('uses an inset box-shadow keyframe (won’t be clipped by ancestor overflow:hidden)', () => {
      makeHost('blocks.0');
      mockLint.mockReturnValue(
        makeLint([{ severity: 'warning', code: 'editor.x', message: 'm', path: ['blocks', 0] }])
      );
      render(<HealthStatusBar blocks={SAMPLE_BLOCKS} />);
      fireEvent.click(screen.getByRole('button', { name: /Locate/i }));

      const keyframes = animateSpy.mock.calls[0]?.[0] as Array<{ boxShadow?: string }>;
      const allInset = keyframes.every((kf) => !kf.boxShadow || kf.boxShadow.startsWith('inset'));
      expect(allInset).toBe(true);
    });
  });

  describe('legend tooltip', () => {
    it('renders the question-circle icon next to the first severity heading', () => {
      window.localStorage.setItem(STORAGE_KEY, 'true');
      mockLint.mockReturnValue(
        makeLint([
          { severity: 'warning', code: 'editor.x', message: 'a', path: ['blocks', 0] },
          { severity: 'info', code: 'editor.y', message: 'b', path: ['blocks', 0] },
        ])
      );
      render(<HealthStatusBar blocks={SAMPLE_BLOCKS} />);

      // Legend lives next to the first non-empty section's label
      // (warnings here, since there are no errors). The button's
      // aria-label is the legend prompt.
      const warningSection = screen.getByText(/Warnings \(1\)/i).parentElement!;
      expect(within(warningSection).getByLabelText(/severities mean/i)).toBeInTheDocument();
    });
  });
});
