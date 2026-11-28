import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { createAssistantContextItem, openAssistant, useProvidePageContext } from '@grafana/assistant';
import { ReaderAssistant, ReaderAssistantIconButton } from './ReaderAssistant';
import type { RawContent } from '../../types/content.types';

jest.mock('@grafana/assistant', () => ({
  createAssistantContextItem: jest.fn((type, params) => ({ type, params })),
  openAssistant: jest.fn(),
  useProvidePageContext: jest.fn(),
  OpenAssistantButton: ({ title, ...props }: Parameters<typeof openAssistant>[0] & { title: string }) => (
    <button onClick={() => openAssistant(props)}>{title}</button>
  ),
}));

jest.mock('../../integrations/assistant-integration/assistant-dev-mode', () => ({
  useIsAssistantAvailable: () => true,
  getOpenAssistant: (props: unknown) => jest.requireMock('@grafana/assistant').openAssistant(props),
}));

it.each([
  { topic: 'path', currentMilestone: 0, currentLesson: undefined },
  { topic: 'module', currentMilestone: 1, currentLesson: 'Module body' },
])('prefills an editable question with $topic context', ({ currentMilestone, currentLesson }) => {
  jest.clearAllMocks();
  const url = 'https://grafana.com/docs/learning-paths/demo/';
  const content: RawContent = {
    content: currentLesson ?? '',
    type: 'learning-journey',
    url,
    lastFetched: '',
    metadata: {
      title: 'Demo',
      learningJourney: { baseUrl: url, currentMilestone, totalMilestones: 1, milestones: [] },
    },
  };
  render(<ReaderAssistant content={content} activeTab={null} />);

  expect(openAssistant).toHaveBeenCalledTimes(1);
  expect(openAssistant).toHaveBeenLastCalledWith({ origin: 'grafana-pathfinder-app/course', autoSend: false });

  expect(createAssistantContextItem).toHaveBeenCalledWith(
    'structured',
    expect.objectContaining({ data: expect.objectContaining({ currentLesson }) })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ask Assistant' }));
  expect(openAssistant).toHaveBeenLastCalledWith(
    expect.objectContaining({
      origin: 'grafana-pathfinder-app/course',
      prompt: 'What will I learn here?',
      context: [jest.mocked(createAssistantContextItem).mock.results[0]!.value],
      autoSend: false,
    })
  );
});

it('offers Assistant for a standalone guide and adds a bounded excerpt to the editable question', () => {
  jest.clearAllMocks();
  const content: RawContent = {
    content: 'x'.repeat(25000),
    type: 'interactive',
    url: 'bundled:my-guide/content.json',
    lastFetched: '',
    metadata: { title: 'My guide' },
  };
  render(<ReaderAssistant content={content} activeTab={null} />);

  expect(openAssistant).not.toHaveBeenCalled();
  expect(useProvidePageContext).toHaveBeenLastCalledWith(expect.any(String), [
    expect.objectContaining({
      params: {
        title: 'Pathfinder Documentation Context',
        data: {
          documentType: 'interactive',
          documentUrl: content.url,
          title: 'My guide',
        },
      },
    }),
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Ask Assistant' }));
  expect(openAssistant).toHaveBeenCalledWith(
    expect.objectContaining({
      origin: 'grafana-pathfinder-app/guide',
      autoSend: false,
      context: [
        expect.objectContaining({
          params: expect.objectContaining({
            data: expect.objectContaining({ guideExcerpt: 'x'.repeat(24000), guideTruncated: true }),
          }),
        }),
      ],
    })
  );
});

it.each(['guide', 'course'] as const)(
  'opens Assistant with the current %s only after clicking the toolbar icon',
  (kind) => {
    jest.clearAllMocks();
    const url = 'https://grafana.com/docs/learning-paths/demo/';
    const content: RawContent = {
      content: 'Current reader content',
      type: kind === 'course' ? 'learning-journey' : 'interactive',
      url,
      lastFetched: '',
      metadata: {
        title: 'Current page',
        ...(kind === 'course' && {
          learningJourney: { baseUrl: url, currentMilestone: 1, totalMilestones: 1, milestones: [] },
        }),
      },
    };
    render(<ReaderAssistantIconButton content={content} activeTab={null} />);

    expect(openAssistant).not.toHaveBeenCalled();
    expect(useProvidePageContext).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: 'Ask Assistant' });
    expect(button).toHaveTextContent(/^$/);
    fireEvent.click(button);
    expect(openAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: `grafana-pathfinder-app/${kind}`,
        prompt: 'What will I learn here?',
        autoSend: false,
        context: [
          expect.objectContaining({
            params: expect.objectContaining({
              data: expect.objectContaining(
                kind === 'course'
                  ? { currentLesson: 'Current reader content' }
                  : { guideExcerpt: 'Current reader content' }
              ),
            }),
          }),
        ],
      })
    );
  }
);
