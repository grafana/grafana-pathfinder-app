/**
 * Section numbering — issue #841
 *
 * Every content block inside a section should be numbered sequentially,
 * regardless of whether it's interactive. Media and wrapper blocks
 * (image / video / conditional) render in the same list but without a number,
 * so an image between two steps doesn't break the 1-2-3 sequence and isn't
 * itself numbered as "step 2".
 */

import React from 'react';
import { render } from '@testing-library/react';
import { shouldNumberSectionChild, wrapSectionChildrenForNumbering } from './interactive-section';
import { InteractiveStep } from './interactive-step';
import { InteractiveMultiStep } from './interactive-multi-step';
import { InteractiveGuided } from './interactive-guided';
import { InteractiveQuiz } from './interactive-quiz';
import { TerminalStep } from './terminal-step';
import { TerminalConnectStep } from './terminal-connect-step';
import { CodeBlockStep } from './code-block-step';
import { InteractiveConditional } from './interactive-conditional';
import { InputBlock } from './input-block';
import { GrotGuideBlock } from './grot-guide-block';
import { ImageRenderer, VideoRenderer, YouTubeVideoRenderer } from '../../docs-retrieval';

describe('shouldNumberSectionChild', () => {
  describe('content blocks — numbered', () => {
    it.each([
      ['InteractiveStep', <InteractiveStep key="s" targetAction="highlight" refTarget=".x" />],
      [
        'InteractiveMultiStep',
        <InteractiveMultiStep key="m" internalActions={[]}>
          x
        </InteractiveMultiStep>,
      ],
      [
        'InteractiveGuided',
        <InteractiveGuided key="g" internalActions={[]}>
          x
        </InteractiveGuided>,
      ],
      [
        'InteractiveQuiz',
        <InteractiveQuiz key="q" question="q" choices={[]}>
          x
        </InteractiveQuiz>,
      ],
      [
        'TerminalStep',
        <TerminalStep key="t" command="ls">
          x
        </TerminalStep>,
      ],
      [
        'TerminalConnectStep',
        <TerminalConnectStep key="tc" buttonText="connect">
          x
        </TerminalConnectStep>,
      ],
      [
        'CodeBlockStep',
        <CodeBlockStep key="cb" code="print('hi')" language="python" refTarget="">
          x
        </CodeBlockStep>,
      ],
      ['InputBlock', <InputBlock key="i" prompt="p" inputType="text" variableName="v" />],
      [
        'GrotGuideBlock',
        <GrotGuideBlock key="gg" welcome={{ title: 'w', body: '', bodyHtml: '', ctas: [] }} screens={[]} />,
      ],
      ['markdown <p>', <p key="md">Some markdown</p>],
      ['markdown <div class="markdown-block">', <div key="mb" className="markdown-block" />],
      ['raw HTML <ul>', <ul key="ul" />],
    ])('numbers %s', (_label, child) => {
      expect(shouldNumberSectionChild(child)).toBe(true);
    });
  });

  describe('media and wrapper blocks — not numbered', () => {
    it('does not number ImageRenderer', () => {
      expect(shouldNumberSectionChild(<ImageRenderer src="/x.png" alt="x" baseUrl="" />)).toBe(false);
    });
    it('does not number VideoRenderer', () => {
      expect(shouldNumberSectionChild(<VideoRenderer src="/x.mp4" baseUrl="" />)).toBe(false);
    });
    it('does not number YouTubeVideoRenderer', () => {
      expect(shouldNumberSectionChild(<YouTubeVideoRenderer src="https://youtu.be/x" />)).toBe(false);
    });
    it('does not number InteractiveConditional', () => {
      expect(
        shouldNumberSectionChild(
          <InteractiveConditional
            conditions={[]}
            whenTrueChildren={[]}
            whenFalseChildren={[]}
            renderElement={() => null}
            keyPrefix="k"
          />
        )
      ).toBe(false);
    });
  });

  describe('non-element children — not numbered', () => {
    it('does not number text nodes', () => {
      expect(shouldNumberSectionChild('plain text' as unknown as React.ReactNode)).toBe(false);
    });
    it('does not number null', () => {
      expect(shouldNumberSectionChild(null)).toBe(false);
    });
  });
});

describe('wrapSectionChildrenForNumbering', () => {
  it('wraps each child in <li> and tags numbered ones', () => {
    const children = [
      <InteractiveStep key="s" targetAction="highlight" refTarget=".a" />,
      <p key="md">Markdown step</p>,
      <ImageRenderer key="img" src="/x.png" alt="x" baseUrl="" />,
      <CodeBlockStep key="cb" code="ls" language="bash" refTarget="" />,
    ];

    const { container } = render(<ol>{wrapSectionChildrenForNumbering(children)}</ol>);
    const items = Array.from(container.querySelectorAll('ol > li'));

    expect(items).toHaveLength(4);
    // Three content blocks numbered; the image is not.
    expect(items[0]?.getAttribute('data-numbered')).toBe('true');
    expect(items[1]?.getAttribute('data-numbered')).toBe('true');
    expect(items[2]?.hasAttribute('data-numbered')).toBe(false);
    expect(items[3]?.getAttribute('data-numbered')).toBe('true');
  });

  it('preserves the original child as the li.firstChild', () => {
    const { container } = render(
      <ol>
        {wrapSectionChildrenForNumbering([
          <p key="md" data-testid="md">
            hi
          </p>,
          <ImageRenderer key="img" src="/x.png" alt="x" baseUrl="" />,
        ])}
      </ol>
    );

    const items = container.querySelectorAll('ol > li');
    expect(items[0]?.querySelector('[data-testid="md"]')).not.toBeNull();
    expect(items[1]?.querySelector('img')).not.toBeNull();
  });
});
