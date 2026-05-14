/**
 * Unit tests for `classifySectionChild` — the issue-#842 gate predicate's
 * input layer. Ported from the abandoned PR #872 test set with one
 * deliberate divergence: a noop `InteractiveStep` is classified as
 * 'interactive' per the issue text ("No-op blocks still count as
 * interactive"). The downstream gate predicate `analyzeAcknowledgement`
 * is responsible for figuring out whether the resulting kinds[] array
 * triggers the gate.
 *
 * We never render these components — we only feed React elements through
 * the classifier and ask what kind it returns. That keeps the suite fast
 * and avoids dragging in the runtime context the section step components
 * normally require.
 */

import React from 'react';

import { CodeBlockStep } from './code-block-step';
import { InteractiveGuided } from './interactive-guided';
import { InteractiveMultiStep } from './interactive-multi-step';
import { InteractiveQuiz } from './interactive-quiz';
import { InteractiveStep } from './interactive-step';
import { classifySectionChild } from './section-child-classifier';
import { TerminalConnectStep } from './terminal-connect-step';
import { TerminalStep } from './terminal-step';

describe('classifySectionChild', () => {
  describe('ignored children', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['true', true as unknown as React.ReactNode],
      ['false', false as unknown as React.ReactNode],
      ['empty string', ''],
      ['whitespace string', '   \n  '],
    ])('classifies %s as ignore', (_name, value) => {
      expect(classifySectionChild(value as React.ReactNode)).toBe('ignore');
    });
  });

  describe('passive children', () => {
    it('classifies a non-empty string as passive (rendered text content)', () => {
      expect(classifySectionChild('hello world')).toBe('passive');
    });

    it('classifies a number as passive', () => {
      expect(classifySectionChild(42 as unknown as React.ReactNode)).toBe('passive');
    });

    it('classifies a plain markup element (markdown HTML output) as passive', () => {
      expect(classifySectionChild(<p>Some markdown rendered as HTML</p>)).toBe('passive');
    });

    it('classifies an image element as passive', () => {
      expect(classifySectionChild(<img src="x.png" alt="x" />)).toBe('passive');
    });

    it('classifies a video element as passive', () => {
      expect(classifySectionChild(<video src="x.mp4" />)).toBe('passive');
    });

    it('classifies a div wrapper as passive', () => {
      expect(classifySectionChild(<div className="markdown-content">text</div>)).toBe('passive');
    });
  });

  describe('interactive children', () => {
    it.each<[string, string]>([
      ['button', 'button'],
      ['highlight', 'highlight'],
      ['formfill', 'formfill'],
      ['navigate', 'navigate'],
      ['hover', 'hover'],
      ['popout', 'popout'],
    ])('classifies an InteractiveStep with targetAction=%s as interactive', (_name, action) => {
      expect(
        classifySectionChild(
          <InteractiveStep targetAction={action as any} refTarget="x">
            Step
          </InteractiveStep>
        )
      ).toBe('interactive');
    });

    it('classifies a noop InteractiveStep as interactive (per issue #842 spec: "no-op blocks still count as interactive")', () => {
      expect(
        classifySectionChild(
          <InteractiveStep targetAction="noop" refTarget="" showMe={false} doIt={false}>
            Informational text
          </InteractiveStep>
        )
      ).toBe('interactive');
    });

    it('classifies an InteractiveMultiStep as interactive', () => {
      expect(classifySectionChild(<InteractiveMultiStep internalActions={[]}>Multi</InteractiveMultiStep>)).toBe(
        'interactive'
      );
    });

    it('classifies an InteractiveGuided as interactive', () => {
      expect(classifySectionChild(<InteractiveGuided internalActions={[]}>Guided</InteractiveGuided>)).toBe(
        'interactive'
      );
    });

    it('classifies an InteractiveQuiz as interactive', () => {
      expect(
        classifySectionChild(
          <InteractiveQuiz question="What is 2+2?" choices={[]}>
            Quiz
          </InteractiveQuiz>
        )
      ).toBe('interactive');
    });

    it('classifies a TerminalStep as interactive', () => {
      expect(classifySectionChild(<TerminalStep command="ls">terminal</TerminalStep>)).toBe('interactive');
    });

    it('classifies a TerminalConnectStep as interactive', () => {
      expect(classifySectionChild(<TerminalConnectStep>connect</TerminalConnectStep>)).toBe('interactive');
    });

    it('classifies a CodeBlockStep as interactive', () => {
      expect(
        classifySectionChild(
          <CodeBlockStep code="echo hi" refTarget=".">
            code
          </CodeBlockStep>
        )
      ).toBe('interactive');
    });
  });
});
