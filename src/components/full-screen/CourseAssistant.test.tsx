import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { createAssistantContextItem, openAssistant } from '@grafana/assistant';
import { CourseAssistant } from './CourseAssistant';
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
}));

it.each([
  { topic: 'path', currentMilestone: 0, currentLesson: undefined },
  { topic: 'module', currentMilestone: 1, currentLesson: 'Module body' },
])('prefills an editable question with $topic context', ({ topic, currentMilestone, currentLesson }) => {
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
  render(<CourseAssistant content={content} activeTab={null} />);

  expect(openAssistant).toHaveBeenCalledTimes(1);
  expect(openAssistant).toHaveBeenLastCalledWith({ origin: 'grafana-pathfinder-app/course', autoSend: false });

  expect(createAssistantContextItem).toHaveBeenCalledWith(
    'structured',
    expect.objectContaining({ data: expect.objectContaining({ currentLesson }) })
  );
  fireEvent.click(screen.getByRole('button', { name: `Ask about this ${topic}` }));
  expect(openAssistant).toHaveBeenLastCalledWith(
    expect.objectContaining({
      origin: 'grafana-pathfinder-app/course',
      prompt: `What will I learn in this ${topic}?`,
      context: [jest.mocked(createAssistantContextItem).mock.results[0]!.value],
      autoSend: false,
    })
  );
});
