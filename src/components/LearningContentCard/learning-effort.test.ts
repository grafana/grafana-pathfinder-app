import { learningEffort } from './learning-effort';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));

describe('learningEffort', () => {
  it('counts every distinct guide of a tracked path, not only its Fundamentals milestones', () => {
    const manifest = {
      milestones: ['setup', 'agents'],
      tracks: [
        { trackId: 'metrics', label: 'Metrics', guides: ['setup', 'agents', 'm-1', 'm-2'] },
        { trackId: 'logs', label: 'Logs', guides: ['setup', 'agents', 'l-1', 'l-2'] },
      ],
    };

    expect(learningEffort(manifest, 'path')).toBe('6 milestones');
  });

  it('counts a track-only path and keeps the plain milestone count otherwise', () => {
    expect(learningEffort({ tracks: [{ trackId: 'ops', label: 'Ops', guides: ['a'] }] }, 'path')).toBe('1 milestone');
    expect(learningEffort({ milestones: ['a', 'b', 'c'], estimatedMinutes: 30 }, 'path')).toBe(
      '3 milestones · About 30 min'
    );
    expect(learningEffort({ milestones: [] }, 'path')).toBe('0 milestones');
    expect(learningEffort({}, 'path')).toBe('');
  });
});
