import React from 'react';
import type { LearningInsightsResponse } from '../../types/learning-insights';
import { personName, displayTime, completionMethod } from './insights.helpers';
import type { InsightsStyles } from './learning-insights.styles';

interface Props {
  data: LearningInsightsResponse;
  userId: string;
  styles: InsightsStyles;
  timeZone?: string;
}

export function PersonEvidence({ data, userId, styles: s, timeZone = 'UTC' }: Props) {
  const person = data.people.find((candidate) => candidate.userId === userId);
  const completions = data.completions.filter((row) => row.userId === userId);
  return (
    <aside aria-label={`Completion history for ${personName(person, userId)}`}>
      <details className={s.section}>
        <summary>Completion history in selected period ({completions.length})</summary>
        {!completions.length && (
          <p className={s.muted}>
            No completion records returned in this period. Older evidence may still satisfy an assignment.
          </p>
        )}
        <ul>
          {[...completions]
            .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
            .map((row) => (
              <li key={JSON.stringify([row.guideSource, row.guideId])}>
                <span className={s.success}>✓ {row.guideTitle || row.guideId}</span>
                <div className={s.muted}>
                  {completionMethod(row.source)} ·{' '}
                  <time dateTime={row.completedAt} title={row.completedAt}>
                    {displayTime(row.completedAt, timeZone)}
                  </time>
                </div>
              </li>
            ))}
        </ul>
        <details>
          <summary>Technical details</summary>
          <p className={s.muted}>
            Subject: {userId}
            {person?.userLogin ? ` · Login: ${person.userLogin}` : ''}
          </p>
        </details>
      </details>
    </aside>
  );
}
