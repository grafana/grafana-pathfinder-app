import { buildCourseContext } from './course-context';
import type { RawContent, Milestone } from '../../types/content.types';

const fundamentals: Milestone[] = [{ number: 1, title: 'Overview', url: 'backend-guide:overview', isActive: false }];
const builder: Milestone[] = [
  { number: 1, title: 'Build a dashboard', description: 'Create panels.', url: 'backend-guide:build', isActive: false },
];
const cover: RawContent = {
  content: '{"blocks":[]}',
  url: 'backend-guide:foundations',
  type: 'learning-journey',
  lastFetched: '',
  metadata: {
    title: 'Grafana foundations',
    packageManifest: {
      id: 'foundations',
      title: 'Grafana foundations',
      type: 'path',
      description: 'Learn Grafana.',
      tracks: [{ trackId: 'builder', label: 'Builder', guides: ['build'] }],
    },
    learningJourney: {
      currentMilestone: 0,
      totalMilestones: 1,
      baseUrl: 'backend-guide:foundations',
      milestones: fundamentals,
      tracks: [{ trackId: 'builder', label: 'Builder', milestones: builder }],
    },
  },
};

it('replaces the default outline with the selected track and its module descriptions', () => {
  const context = buildCourseContext(cover, {
    activeTrackId: 'builder',
    activeTrackPathId: 'foundations',
    activeTrackMilestones: builder,
  });
  expect(context?.selectedTrack).toEqual({ id: 'builder', label: 'Builder' });
  expect(context?.modules).toEqual([
    { title: 'Build a dashboard', description: 'Create panels.', url: 'backend-guide:build' },
  ]);
  expect(context?.currentPage.isOverview).toBe(true);
  expect(context?.currentLesson).toBeUndefined();
});

it('keeps the owning course and selected outline when opening a track-only lesson', () => {
  const lesson: RawContent = {
    ...cover,
    type: 'interactive',
    url: 'backend-guide:build',
    content: '{"blocks":[{"type":"markdown","content":"Create a panel."}]}',
    metadata: {
      title: 'Build a dashboard',
      journeyManifest: cover.metadata.packageManifest,
      trackMemberBaseUrl: cover.url,
    },
  };
  const context = buildCourseContext(lesson, {
    activeTrackId: 'builder',
    activeTrackPathId: 'foundations',
    activeTrackMilestones: builder,
  });
  expect(context?.courseTitle).toBe('Grafana foundations');
  expect(context?.selectedTrack.label).toBe('Builder');
  expect(context?.currentLesson).toBe(lesson.content);
  expect(context?.modules[0]?.title).toBe('Build a dashboard');
});

it('ignores a track selection retained from another course', () => {
  const context = buildCourseContext(cover, {
    activeTrackId: 'builder',
    activeTrackPathId: 'another-course',
    activeTrackMilestones: builder,
  });
  expect(context?.selectedTrack).toEqual({ id: null, label: 'Fundamentals' });
  expect(context?.modules[0]?.title).toBe('Overview');
});

it('bounds lesson content and identifies when the supplied lesson is incomplete', () => {
  const lesson = {
    ...cover,
    content: 'x'.repeat(25000),
    metadata: { ...cover.metadata, learningJourney: { ...cover.metadata.learningJourney!, currentMilestone: 1 } },
  };
  const context = buildCourseContext(lesson, null);
  expect(context?.currentLesson).toHaveLength(24000);
  expect(context?.lessonTruncated).toBe(true);
});

it('does not register ordinary standalone documentation as a course', () => {
  expect(
    buildCourseContext({ ...cover, type: 'interactive', metadata: { title: 'Standalone guide' } }, null)
  ).toBeNull();
});

it('preserves the course title when a backend lesson manifest uses the lesson title', () => {
  const lesson: RawContent = {
    ...cover,
    metadata: {
      ...cover.metadata,
      title: 'Observability Foundations',
      packageManifest: { ...cover.metadata.packageManifest, title: 'Observability Foundations' },
      learningJourney: { ...cover.metadata.learningJourney!, currentMilestone: 1 },
    },
  };
  const context = buildCourseContext(lesson, {
    title: 'Grafana foundations',
    activeTrackId: 'builder',
    activeTrackPathId: 'foundations',
    activeTrackMilestones: builder,
  });
  expect(context?.courseTitle).toBe('Grafana foundations');
  expect(context?.currentPage.title).toBe('Observability Foundations');
});
