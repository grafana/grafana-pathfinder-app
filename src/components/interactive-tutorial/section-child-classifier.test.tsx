import React from 'react';

import { classifySectionChild } from './section-child-classifier';
import { InteractiveStep } from './interactive-step';
import { InteractiveMultiStep } from './interactive-multi-step';
import { InteractiveGuided } from './interactive-guided';
import { InteractiveQuiz } from './interactive-quiz';
import { TerminalStep } from './terminal-step';
import { TerminalConnectStep } from './terminal-connect-step';
import { CodeBlockStep } from './code-block-step';

// We never render these — we only ask the classifier what *kind* of child
// each one is. This keeps the tests fast and avoids pulling in the full
// runtime context the section components normally need.

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

    it('classifies a noop InteractiveStep as passive', () => {
      expect(
        classifySectionChild(
          <InteractiveStep targetAction="noop" refTarget="" showMe={false} doIt={false}>
            Informational text
          </InteractiveStep>
        )
      ).toBe('passive');
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
