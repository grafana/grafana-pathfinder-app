export type LearningAction = 'read' | 'review' | 'resume' | 'start';

export function getLearningAction(kind: 'guide' | 'path' | 'docs', percent: number): LearningAction {
  if (kind === 'docs') {
    return 'read';
  }
  if (percent === 100) {
    return 'review';
  }
  return percent > 0 ? 'resume' : 'start';
}
